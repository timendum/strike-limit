import { reddit, redis } from "@devvit/web/server";
import { Temporal } from "temporal-polyfill";
import { getBanConfig, getStrikeConfig, getNForBan } from "../../shared/config";
import { formatTextRemoval } from "../../shared/text";
import {
  type BanAction,
  isBanAction,
  isRemovalAction,
  type RemovalAction,
} from "../../shared/types";

/*
# Redis data model

Two sorted sets (ZSETs) per user, keyed by username.

## `user:{username}:removal`

Recorded content removals (one member per removal).

- **score**: `target.createdAt` — epoch **milliseconds** of the removed post/comment.
- **member**: JSON-serialized `RemovalAction`.

## `user:{username}:ban`

Recorded bans (one member per ban).

- **score**: `createdAt` converted to epoch **milliseconds**.
- **member**: JSON-serialized `BanAction`.

## Conventions

- **Dedup**: the same content removed twice counts is stored only once.
- **TTL**: both keys expire 366 days after the last write (`redis.expire` on every add).

*/

export async function storeRemovalAction(action: RemovalAction) {
  const key = `user:${action.target.author}:removal`;
  const score = action.target.createdAt;

  // Check for two removals of the same content
  const existing = await redis.zRange(key, score, score, { by: "score" });
  const alreadyStored = existing
    .map((a) => JSON.parse(a.member))
    .filter(isRemovalAction)
    .some((a) => a.target.id === action.target.id);
  if (alreadyStored) {
    console.log("RemovalReason already stored, skipping", action.target.id);
    return;
  }

  await redis.zAdd(key, {
    score: score,
    member: JSON.stringify(action),
  });
  await redis.expire(key, 366 * 24 * 60 * 60);
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
  await redis.expire(`user:${ban.user}:ban`, 366 * 24 * 60 * 60);
  console.log("Ban stored", ban);
}

async function getBanActions(user: string, since: number) {
  const bans = await redis.zRange(`user:${user}:ban`, since, "+inf", {
    by: "score",
  });
  return bans.map((a) => JSON.parse(a.member)).filter(isBanAction);
}

async function getRemovalActions(user: string, since: number) {
  const removals = await redis.zRange(`user:${user}:removal`, since, "+inf", {
    by: "score",
  });
  return removals.map((a) => JSON.parse(a.member)).filter(isRemovalAction);
}

async function getBans(user: string) {
  const nBans = await redis.zCard(`user:${user}:ban`);
  if (nBans < 1) {
    console.debug(`getBans - ${user} - ${nBans}`);
    return { nBans: 0, lastBan: 0 };
  }

  const bans = await redis.zRange(`user:${user}:ban`, "-inf", "+inf", {
    by: "score",
    reverse: true,
    limit: { offset: 0, count: 1 },
  });
  const banDates = bans
    .map((a) => JSON.parse(a.member))
    .filter(isBanAction)
    .map((a) => a.createdAt);
  console.debug(`getBans - ${user} - ${nBans} - ${banDates}`);
  let lastBan =
    banDates.length > 0
      ? Temporal.Instant.from(banDates[0]).epochMilliseconds
      : 0;
  return { nBans, lastBan };
}

export async function maybeBanUser(user: string) {
  const [strikeConfig, { nBans, lastBan }] = await Promise.all([
    getStrikeConfig(),
    getBans(user),
  ]);
  let since = lastBan;
  if (strikeConfig.spanDays > 0) {
    since = Math.max(
      since,
      Temporal.Now.instant().subtract({ days: strikeConfig.spanDays })
        .epochMilliseconds
    );
  }
  // Retrieve removals
  const removalEntries = await redis.zRange(
    `user:${user}:removal`,
    since,
    "+inf",
    { by: "score" }
  );
  let removals = removalEntries
    .map((a) => JSON.parse(a.member))
    .filter(isRemovalAction);
  if (!strikeConfig.includeReddit) {
    removals = removals.filter((a) => a.modType == "mod");
  }
  const maxStrikes = getNForBan(nBans, strikeConfig.strikesBan);
  console.debug(
    `maybeBanUser - ${user} - ${nBans} - ${maxStrikes} vs ${removals}`
  );
  if (removals.length < maxStrikes) {
    // NO BAN
    return;
  }
  // BAN
  const [banConfig, subreddit] = await Promise.all([
    getBanConfig(),
    reddit.getCurrentSubreddit(),
  ]);
  const duration = getNForBan(nBans, banConfig.banDuration);
  const body = formatTextRemoval(
    { user, removals },
    banConfig.banText,
    banConfig.banEntry
  );
  let sinceTxt = "";
  if (lastBan > 0) {
    sinceTxt =
      " since last ban on " +
      Temporal.Instant.fromEpochMilliseconds(lastBan)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString();
  }
  if (banConfig.noBan) {
    await reddit.modMail.createConversation({
      body: `
User u/${user} is NOT banned, but reached the limit:
${removals.length} removals > ${maxStrikes}${sinceTxt}

Previous bans: ${nBans}.

Ban message follows.

---

${body}`,
      subject: `Strike limit: ${user}`,
      subredditName: subreddit.name,
      to: null, // internal mod discussion
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
      await reddit.modMail.createConversation({
        body: `
**Approved** User u/${user} is NOT banned, but reached the limit:
${removals.length} removals > ${maxStrikes}${sinceTxt}

Previous bans: ${nBans}.

Ban message follows.

---

${body}`,
        subject: `Strike limit: ${user}`,
        subredditName: subreddit.name,
        to: null, // internal mod discussion
      });
      return;
    }
  }
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
  if (
    appUser &&
    conversation.authors.filter((a) => a.name == appUser.username).length > 0
  ) {
    return false;
  }
  const subject = conversation.subject?.toLowerCase();
  //TODO: improve parsing
  if (
    !subject ||
    subject.indexOf("strike") < 0 ||
    subject.indexOf("query") < 0
  ) {
    return false;
  }
  const user = subject
    .replace("strike", "")
    .replace("query", "")
    .trim()
    .replace(/^u(ser)?\//, "");
  if (user.length < 3) {
    console.log("No user in subject:", subject);
    return false;
  }
  const [removals, bans] = await Promise.all([
    getRemovalActions(user, 0),
    getBanActions(user, 0),
  ]);

  let body = formatTextRemoval(
    { user, removals },
    "Recorded removed contents for u/{user}:\n\n{list}",
    "- {date} - [{kind} removal]({permalink})"
  );
  //TODO: add bans info
  await reddit.modMail.reply({
    body,
    conversationId: conversationId,
  });
  return true;
}
