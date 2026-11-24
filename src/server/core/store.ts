import { redis } from "@devvit/web/server";
import { Temporal } from "temporal-polyfill";

import {
  type BanAction,
  isBanAction,
  isNoBanAction,
  isRemovalAction,
  type ModMailBanRequest,
  type NoBanAction,
  type RemovalAction,
} from "../../shared/types";

/** Redis persistence for removals, bans, noBan events and ModMail ban requests. */

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

/** @returns false if the removal was already stored (repeated delivery) */
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
    return false;
  }

  await redis.zAdd(key, {
    score: score,
    member: JSON.stringify(action),
  });
  await extendExpiration(action.target.author);
  console.log("RemovalReason stored", action);
  return true;
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

export async function storeNoBan(ban: NoBanAction) {
  const score = Temporal.Instant.from(ban.createdAt).epochMilliseconds;
  await redis.zAdd(`user:${ban.user}:noBan`, {
    score: score,
    member: JSON.stringify(ban),
  });
  await extendExpiration(ban.user);
  console.log("Ban stored", ban);
}

export async function getBanActions(user: string, since: number) {
  const bans = await redis.zRange(`user:${user}:ban`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(bans, isBanAction).map((a) => a[0]);
}

export async function getRemovalActions(user: string, since: number) {
  const removals = await redis.zRange(`user:${user}:removal`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(removals, isRemovalAction).map((a) => a[0]);
}

export async function getNoBanActions(user: string, since: number) {
  const bans = await redis.zRange(`user:${user}:noBan`, since, "+inf", {
    by: "score",
  });
  return parseZSetMembers(bans, isNoBanAction).map((a) => a[0]);
}

/**
 * Retrieve ban related information.
 * @param user Reddit user
 * @param ignoreNoBanFrom if set (epoch ms), `noBan` entries scored at or after it are ignored
 * @returns number of real bans, last ban or "noBan"
 */
export async function getUserBans(user: string, ignoreNoBanFrom?: number) {
  const [nBans, nNoBans] = await Promise.all([
    redis.zCard(`user:${user}:ban`),
    redis.zCard(`user:${user}:noBan`),
  ]);
  if (nBans + nNoBans < 1) {
    console.debug(`getUserBans - ${user} - ${nBans} - ${nNoBans}`);
    return { nBans: 0, lastBan: 0 };
  }

  let lastBan = 0;
  if (nNoBans > 0 && ignoreNoBanFrom === undefined) {
    const bans = await redis.zRange(`user:${user}:noBan`, "-inf", "+inf", {
      by: "score",
      reverse: true,
      limit: { offset: 0, count: 1 },
    });
    const banDates = parseZSetMembers(bans, isNoBanAction).map((a) => a[0].createdAt);
    console.debug(`getUserBans - ${user} - noBans: ${nNoBans} -`, banDates);
    lastBan = banDates.length > 0 ? Temporal.Instant.from(banDates[0]).epochMilliseconds : 0;
  } else if (nNoBans > 0 && ignoreNoBanFrom !== undefined) {
    const bans = await redis.zRange(`user:${user}:noBan`, "-inf", ignoreNoBanFrom - 1, {
      by: "score",
    });
    const banDates = parseZSetMembers(bans, isNoBanAction).map(
      (a) => Temporal.Instant.from(a[0].createdAt).epochMilliseconds,
    );
    lastBan = banDates.length > 0 ? Math.max(...banDates) : 0;
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

const MODMAIL_TTL_SECONDS = 366 * 24 * 60 * 60;

export function normalizeConversationId(id: string) {
  return id.replace(/^ModmailConversation_/, "");
}

export function normalizeMessageId(id: string) {
  return id.replace(/^ModmailMessage_/, "");
}

/** Remember that conversation `conversationId` offers to ban `request.user` on a "ban" reply. */
export async function storeModmailBanRequest(
  conversationId: string,
  request: Omit<ModMailBanRequest, "handled">,
) {
  const key = `modmail:${normalizeConversationId(conversationId)}`;
  await redis.hSet(key, {
    user: request.user,
    duration: String(request.duration),
    notifiedAt: String(request.notifiedAt),
  });
  await redis.expire(key, MODMAIL_TTL_SECONDS);
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
