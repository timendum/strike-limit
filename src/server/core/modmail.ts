import { reddit, redis } from "@devvit/web/server";

import { getBanConfig, getNForBan } from "../../shared/config";
import {
  formatBanDuration,
  formatLastBan,
  formatTextBan,
  formatTextNoBan,
  formatTextRemoval,
} from "../../shared/text";
import { parseModMailBanRequest } from "../../shared/types";
import { evaluateStrikes } from "./evaluate";
import {
  getBanActions,
  getNoBanActions,
  getRemovalActions,
  normalizeConversationId,
  normalizeMessageId,
} from "./store";

function stripMarkup(text: string) {
  return text.replace(/<[^>]*>/g, "");
}

async function replyInConversation(conversationId: string, body: string) {
  await reddit.modMail.reply({ conversationId, body });
}

/**
 * Handle a new message in a conversation: if it is a moderator reply "ban" in a notification
 * conversation created by the app, ban the user.
 * @returns true if the message was a valid "ban" reply that was processed
 */
export async function replyBanFromModMail(input: {
  conversationId: string;
  messageId: string;
}): Promise<boolean> {
  const conversationId = normalizeConversationId(input.conversationId);
  const key = `modmail:${conversationId}`;
  const request = parseModMailBanRequest(await redis.hGetAll(key));
  if (!request || request.handled) {
    return false;
  }
  console.debug("replyBanFromModMail: ModMail found", request);

  const [{ conversation }, appUser] = await Promise.all([
    reddit.modMail.getConversation({ conversationId }),
    reddit.getAppUser(),
  ]);
  if (!conversation) {
    return false;
  }
  const messages = Object.entries(conversation.messages ?? {});
  const wanted = normalizeMessageId(input.messageId);
  const message =
    messages.find(
      ([k, m]) => normalizeMessageId(k) === wanted || normalizeMessageId(m.id ?? "") === wanted,
    )?.[1] ??
    messages
      .map(([, m]) => m)
      .sort((a, b) => Date.parse(b.date ?? "") - Date.parse(a.date ?? ""))[0];
  if (!message) {
    return false;
  }
  const text = stripMarkup(message.bodyMarkdown ?? message.body ?? "")
    .trim()
    .toLowerCase();
  if (text !== "ban") {
    return false;
  }
  console.debug("replyBanFromModMail: is ban");

  const author = message.author;
  const authorName = author?.name;
  if (
    !authorName ||
    author?.isHidden ||
    author?.isDeleted ||
    authorName.toLowerCase() === appUser?.username.toLowerCase()
  ) {
    return false;
  }
  const subreddit = await reddit.getCurrentSubreddit();
  let canManageUsers = false;
  try {
    const mods = await reddit
      .getModerators({ subredditName: subreddit.name, username: authorName })
      .all();
    canManageUsers = mods.some(
      (m) =>
        m.username.toLowerCase() === authorName.toLowerCase() &&
        m.moderatorInfo?.modPermissions?.some((p) => p === "access" || p === "all"),
    );
  } catch (e) {
    console.error("Cannot check moderator permissions", authorName, e);
  }
  if (!canManageUsers) {
    console.log("replyBanFromModMail: Ignoring ban reply from non-authorized author", authorName);
    return false;
  }

  // Claim: a repeated delivery of the same event must not ban twice.
  if ((await redis.hSetNX(key, "lock", "1")) !== 1) {
    return false;
  }
  const user = request.user;
  let release = true;
  try {
    const banned = await reddit
      .getBannedUsers({ subredditName: subreddit.name, username: user })
      .all();
    if (banned.length > 0) {
      release = false;
      await redis.hSet(key, { handled: "1" });
      await replyInConversation(conversationId, `already banned: u/${user} is already banned.`);
      return true;
    }

    const { nBans, lastBan, removals, maxStrikes } = await evaluateStrikes(
      user,
      request.notifiedAt,
    );
    if (removals.length < maxStrikes) {
      await replyInConversation(
        conversationId,
        `u/${user} was not banned: they now have ${removals.length} removals${formatLastBan(lastBan)}, below the limit of ${maxStrikes} (some strikes were probably removed by approvals).`,
      );
      return true;
    }

    const banConfig = await getBanConfig();
    const duration = getNForBan(nBans, banConfig.banDuration);
    const body = formatTextRemoval(
      { user, removals },
      banConfig.banText,
      banConfig.banEntry,
      "Check me",
    );
    release = false;
    try {
      await reddit.banUser({
        username: user,
        subredditName: subreddit.name,
        duration: duration > 0 ? duration : undefined,
        message: body,
        note: `Strike-limit: ${nBans} previous bans - ${removals.length} removals${formatLastBan(lastBan)}. Confirmed by u/${authorName} via modmail.`,
      });
    } catch (e) {
      await redis.hSet(key, { handled: "1" });
      await replyInConversation(
        conversationId,
        `Ban failed for u/${user}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
    await redis.hSet(key, { handled: "1" });
    await replyInConversation(
      conversationId,
      `user banned: u/${user} is banned ${formatBanDuration(duration)}.`,
    );
    return true;
  } finally {
    if (release) {
      await redis.hDel(key, ["lock"]);
    }
  }
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
