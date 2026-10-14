import { reddit, redis } from "@devvit/web/server";
import { Temporal } from "temporal-polyfill";

import { getBanConfig, getStrikeConfig, getNForBan } from "../../shared/config";
import {
  formatLastBan,
  formatNotBanned,
  formatTextBan,
  formatTextNoBan,
  formatTextRemoval,
} from "../../shared/text";
import {
  type BanAction,
  isBanAction,
  isNoBanAction,
  isRemovalAction,
  NoBanAction,
  type RemovalAction,
} from "../../shared/types";

async function extendExpiration(user: string) {
  const seconds = 366 * 24 * 60 * 60;
  await Promise.all([
    redis.expire(`user:${user}:ban`, seconds),
    redis.expire(`user:${user}:removal`, seconds),
    redis.expire(`user:${user}:noBan`, seconds),
  ]);
  return;
}

function parseZSetMembers<T>(
  entries: { member: string }[],
  guard: (value: unknown) => value is T,
): [T, string][] {
  const result: [T, string][] = [];
  for (const entry of entries) {
    try {
      const parsed: unknown = JSON.parse(entry.member);
      if (guard(parsed)) {
        result.push([parsed, entry.member]);
      }
    } catch {
      // Skip malformed JSON
    }
  }
  return result;
}

export async function storeRemovalAction(action: RemovalAction) {
  const key = `user:${action.target.author}:removal`;
  const score = action.target.createdAt;

  // Check for two removals of the same content
  const existing = await redis.zRange(key, score, score, { by: "score" });
  const alreadyStored = parseZSetMembers(existing, isRemovalAction).some(
    (a) => a[0].target.id === action.target.id,
  );
  if (alreadyStored) {
    console.log("RemovalReason already stored, skipping", action.target.id);
    return;
  }

  await redis.zAdd(key, {
    score: score,
    member: JSON.stringify(action),
  });
  await extendExpiration(action.target.author);
  console.log("RemovalReason stored", action);

  await maybeBanUser(action.target.author);
}

export async function storeBan(ban: BanAction) {
  // no filter, include app own bans.
  const score = Temporal.Instant.from(ban.createdAt).epochMilliseconds;
  await redis.zAdd(`user:${ban.user}:ban`, {
    score: score,
    member: JSON.stringify(ban),
  });
  await extendExpiration(ban.user);
  console.log("Ban stored", ban);
}

async function storeNoBan(ban: NoBanAction) {
  const score = Temporal.Instant.from(ban.createdAt).epochMilliseconds;
  await redis.zAdd(`user:${ban.user}:noBan`, {
    score: score,
    member: JSON.stringify(ban),
  });
  await extendExpiration(ban.user);
  console.log("Ban stored", ban);
}

async function getBanActions(user: string, since: number) {
  const bans = await redis.zRange(`user:${user}:ban`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(bans, isBanAction).map((a) => a[0]);
}

async function getRemovalActions(user: string, since: number) {
  const removals = await redis.zRange(`user:${user}:removal`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(removals, isRemovalAction).map((a) => a[0]);
}

async function getNoBanActions(user: string, since: number) {
  const bans = await redis.zRange(`user:${user}:noBan`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(bans, isNoBanAction).map((a) => a[0]);
}

/**
 * Retrieve ban related information.
 * @param user Reddit user
 * @returns number of real bans, last ban or "noBan"
 */
async function getUserBans(user: string) {
  const [nBans, nNoBans] = await Promise.all([
    redis.zCard(`user:${user}:ban`),
    redis.zCard(`user:${user}:noBan`),
  ]);
  if (nBans + nNoBans < 1) {
    console.debug(`getUserBans - ${user} - ${nBans} - ${nNoBans}`);
    return { nBans: 0, lastBan: 0 };
  }

  let lastBan = 0;
  if (nNoBans > 0) {
    const bans = await redis.zRange(`user:${user}:noBan`, "-inf", "+inf", {
      by: "score",
      reverse: true,
      limit: { offset: 0, count: 1 },
    });
    const banDates = parseZSetMembers(bans, isNoBanAction).map((a) => a[0].createdAt);
    console.debug(`getUserBans - ${user} - noBans: ${nNoBans} -`, banDates);
    lastBan = banDates.length > 0 ? Temporal.Instant.from(banDates[0]).epochMilliseconds : 0;
  }
  if (nBans > 0) {
    const bans = await redis.zRange(`user:${user}:ban`, "-inf", "+inf", {
      by: "score",
      reverse: true,
      limit: { offset: 0, count: 1 },
    });
    const banDates = parseZSetMembers(bans, isBanAction).map((a) => a[0].createdAt);
    console.debug(`getUserBans - ${user} - bans: ${nBans} -`, banDates);
    lastBan = Math.max(
      banDates.length > 0 ? Temporal.Instant.from(banDates[0]).epochMilliseconds : 0,
      lastBan,
    );
  }
  console.debug(`getUserBans - ${user} - ${nBans} - ${nNoBans}`);
  return { nBans, lastBan };
}

export async function maybeBanUser(user: string) {
  const [strikeConfig, { nBans, lastBan }] = await Promise.all([
    getStrikeConfig(),
    getUserBans(user),
  ]);
  let since = lastBan;
  if (strikeConfig.spanDays > 0) {
    since = Math.max(
      since,
      Temporal.Now.instant().toZonedDateTimeISO("UTC").subtract({ days: strikeConfig.spanDays })
        .epochMilliseconds,
    );
  }
  // Retrieve removals
  const removalEntries = await redis.zRange(`user:${user}:removal`, since, "+inf", { by: "score" });
  let removals = parseZSetMembers(removalEntries, isRemovalAction).map((a) => a[0]);
  const maxStrikes = getNForBan(nBans, strikeConfig.strikesBan);
  console.debug(`maybeBanUser - ${user} - ${nBans} - ${maxStrikes} vs`, removals);
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
  if (banConfig.noBan) {
    // Only ModMail by config
    await reddit.modMail.createConversation({
      body: formatNotBanned({
        prefix: "User",
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
      await reddit.modMail.createConversation({
        body: formatNotBanned({
          prefix: "**Approved** user",
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
  }
  const [moderators, banned] = await Promise.all([
    reddit
      .getModerators({
        subredditName: subreddit.name,
        username: user,
      })
      .all(),
    reddit
      .getBannedUsers({
        subredditName: subreddit.name,
        username: user,
      })
      .all(),
  ]);
  const isModerator = moderators.length > 0;
  if (isModerator) {
    // Moderator: No ban, Only ModMail
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
    note: `Strike-limit: ${nBans} previous bans - ${removals.length} removals > ${maxStrikes}${sinceTxt}.`,
  });
}

export async function replyModMailQuery(conversationId: string) {
  const [getConversation, appUser] = await Promise.all([
    reddit.modMail.getConversation({ conversationId }),
    reddit.getAppUser(),
  ]);
  if (!getConversation.conversation) {
    return false;
  }
  const conversation = getConversation.conversation;
  // avoid loop: don't reply to mail from app
  if (appUser && conversation.authors.filter((a) => a.name == appUser.username).length > 0) {
    return false;
  }

  const match = conversation.subject?.match(
    /^\s*strike[\s-]*query\s*:?\s*(?:u(?:ser)?\/)?([A-Za-z0-9_-]{3,})\s*$/i,
  );
  const user = match?.[1];
  if (!user) {
    console.log("No user in subject:", conversation.subject);
    return false;
  }
  const [removals, bans, noBans] = await Promise.all([
    getRemovalActions(user, 0),
    getBanActions(user, 0),
    getNoBanActions(user, 0),
  ]);

  let body = formatTextRemoval(
    { user, removals },
    "Recorded removed contents for u/{user}:\n\n{list}",
    "- {date} - [{kind} removal]({permalink})",
    "No recorded removed contents for u/{user}.",
  );
  body +=
    "\n\n" +
    formatTextBan(
      { user, bans },
      "Recorded bans for u/{user}:\n\n{list}",
      "- {date}",
      "No recorded bans for u/{user}.",
    );
  body +=
    "\n\n" +
    formatTextNoBan(
      { user, noBans },
      "Recorded no-ban events for u/{user}:\n\n{list}",
      "- {date} ({reason})",
      "No recorded no-ban events for u/{user}.",
    );
  await reddit.modMail.reply({
    body,
    conversationId: conversationId,
  });
  return true;
}

/**
 * Undo a recent ban
 */
export async function removeBanIfRecent(ban: BanAction) {
  const createdAt = Temporal.Instant.from(ban.createdAt).epochMilliseconds;
  const key = `user:${ban.user}:ban`;
  const deltaT = 23 * 60 * 60 * 100;

  const entries = await redis.zRange(key, createdAt - deltaT, createdAt, {
    by: "score",
  });
  const candidates = parseZSetMembers(entries, isBanAction).filter(
    ([b]) => createdAt - Temporal.Instant.from(b.createdAt).epochMilliseconds < deltaT,
  );
  if (candidates.length === 0) {
    console.log("No recent ban to undo for unban", ban);
    return false;
  }

  // Most recent qualifying ban.
  const [, original] = candidates.reduce((latest, current) =>
    Temporal.Instant.from(current[0].createdAt).epochMilliseconds >
    Temporal.Instant.from(latest[0].createdAt).epochMilliseconds
      ? current
      : latest,
  );

  await redis.zRem(key, [original]);
  await storeNoBan({
    createdAt: ban.createdAt,
    user: ban.user,
    from: "unban",
  });
  console.log("Ban undone (recent unban)", ban);
  return true;
}

export async function removeRemovalAction(action: RemovalAction) {
  const key = `user:${action.target.author}:removal`;
  const score = action.target.createdAt;

  // Check for two removals of the same content
  const existing = await redis.zRange(key, score, score, { by: "score" });
  const alreadyStored = parseZSetMembers(existing, isRemovalAction).filter(
    (a) => a[0].target.id === action.target.id,
  );
  if (alreadyStored.length == 0) {
    console.info("RemovalReason NOT stored, skipping ApprovalAction on ", action.target.id);
    return;
  }

  await redis.zRem(
    key,
    alreadyStored.map((a) => a[1]),
  );
  console.log("RemovalReason removed", action);
}
