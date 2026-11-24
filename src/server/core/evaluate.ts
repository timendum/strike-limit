import { reddit } from "@devvit/web/server";
import { Temporal } from "temporal-polyfill";

import { getBanConfig, getNForBan, getStrikeConfig } from "../../shared/config";
import { formatLastBan, formatNotBanned, formatTextRemoval } from "../../shared/text";
import type { RemovalAction } from "../../shared/types";
import { getRemovalActions, getUserBans, storeModmailBanRequest, storeNoBan } from "./store";

/**
 * Load strike config, ban history and the removals counting towards the next ban.
 * @param ignoreNoBanFrom see `getUserBans`
 */
export async function evaluateStrikes(user: string, ignoreNoBanFrom?: number) {
  const [strikeConfig, { nBans, lastBan }] = await Promise.all([
    getStrikeConfig(),
    getUserBans(user, ignoreNoBanFrom),
  ]);
  let since = lastBan;
  if (strikeConfig.spanDays > 0) {
    since = Math.max(
      since,
      Temporal.Now.instant().toZonedDateTimeISO("UTC").subtract({ days: strikeConfig.spanDays })
        .epochMilliseconds,
    );
  }
  const removals = await getRemovalActions(user, since);
  const maxStrikes = getNForBan(nBans, strikeConfig.strikesBan);
  console.debug(`evaluateStrikes - ${user} - ${nBans} - ${maxStrikes} vs`, removals);
  return { nBans, lastBan, removals, maxStrikes };
}

/**
 * Send the notify-only ModMail, record the `noBan` entry and, when the conversation id is
 * known, the mapping that lets a moderator reply "ban".
 */
async function notifyNotBanned(params: {
  prefix: string;
  body: string;
  user: string;
  lastBan: number;
  maxStrikes: number;
  removals: RemovalAction[];
  nBans: number;
  banDays: number;
  subredditName: string;
}) {
  const { subredditName, ...format } = params;
  const created = await reddit.modMail.createConversation({
    body: formatNotBanned(format),
    subject: `Strike limit: ${params.user}`,
    subredditName,
    to: null, // internal mod discussion
  });
  const notifiedAt = Temporal.Now.instant();
  await storeNoBan({
    createdAt: notifiedAt.toString(),
    user: params.user,
    from: "notification",
  });
  const conversationId = created?.conversation?.id;
  if (typeof conversationId === "string" && conversationId.length > 0) {
    await storeModmailBanRequest(conversationId, {
      user: params.user,
      duration: params.banDays,
      notifiedAt: notifiedAt.epochMilliseconds,
    });
  } else {
    console.warn("No conversation id returned, reply-to-ban unavailable", params.user);
  }
}

export async function maybeBanUser(user: string) {
  const { nBans, lastBan, removals, maxStrikes } = await evaluateStrikes(user);
  if (removals.length < maxStrikes) {
    // NO BAN
    return;
  }
  // BAN
  const [banConfig, subreddit] = await Promise.all([getBanConfig(), reddit.getCurrentSubreddit()]);
  const duration = getNForBan(nBans, banConfig.banDuration);
  const body = formatTextRemoval(
    { user, removals },
    banConfig.banText,
    banConfig.banEntry,
    "Check me",
  );
  const moderators = await reddit
    .getModerators({
      subredditName: subreddit.name,
      username: user,
    })
    .all();
  if (moderators.length > 0) {
    // Moderator: No ban, Only ModMail (no "reply ban" mapping), whatever the config
    await reddit.modMail.createConversation({
      body: formatNotBanned({
        prefix: "**Moderator**",
        body,
        user,
        lastBan,
        maxStrikes,
        removals,
        nBans,
      }),
      subject: `Strike limit: ${user}`,
      subredditName: subreddit.name,
      to: null, // internal mod discussion
    });
    await storeNoBan({
      createdAt: Temporal.Now.instant().toString(),
      user: user,
      from: "notification",
    });
    return;
  }
  if (banConfig.ignoreApproved) {
    const approvedUsers = await reddit
      .getApprovedUsers({
        subredditName: subreddit.name,
        username: user,
      })
      .all();
    const isApproved = approvedUsers.length > 0;
    if (isApproved) {
      // Approved: No ban, Only ModMail
      await notifyNotBanned({
        prefix: "**Approved** user",
        body,
        user,
        lastBan,
        maxStrikes,
        removals,
        nBans,
        banDays: duration,
        subredditName: subreddit.name,
      });
      return;
    }
  }
  if (!banConfig.doBan) {
    // Only ModMail by config
    await notifyNotBanned({
      prefix: "User",
      body,
      user,
      lastBan,
      maxStrikes,
      removals,
      nBans,
      banDays: duration,
      subredditName: subreddit.name,
    });
    return;
  }
  const banned = await reddit
    .getBannedUsers({
      subredditName: subreddit.name,
      username: user,
    })
    .all();
  const isBanned = banned.length > 0;
  if (isBanned) {
    // Already banned: No ban, no ModMail
    return;
  }
  const sinceTxt = formatLastBan(lastBan);
  await reddit.banUser({
    username: user,
    subredditName: subreddit.name,
    duration: duration > 0 ? duration : undefined,
    message: body,
    note: `Strike-limit: ${nBans} previous bans - ${removals.length} removals${sinceTxt}.`,
  });
}
