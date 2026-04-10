import { redis } from "@devvit/web/server";
import { Temporal } from "temporal-polyfill";

type RemovalAction = {
  createdAt: string;
  target: {
    createdAt: number;
    author: string;
    postId: string;
  };
};

export function isRemovalAction(obj: unknown): obj is RemovalAction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "createdAt" in obj &&
    typeof obj.createdAt === "string" &&
    "target" in obj &&
    typeof obj.target === "object" &&
    obj.target !== null &&
    "id" in obj.target &&
    typeof obj.target.id === "string" &&
    "createdAt" in obj.target &&
    typeof obj.target.createdAt === "number" &&
    "author" in obj.target &&
    typeof obj.target.author === "string" &&
    "postId" in obj.target &&
    typeof obj.target.postId === "string"
  );
}

export async function storeRemovalAction(action: RemovalAction) {
  const score = action.target.createdAt;
  await redis.zAdd(`user:${action.target.author}:removal`, {
    score: score,
    member: JSON.stringify(action),
  });
  await redis.expire(`user:${action.target.author}:removal`, 366 * 24 * 60 * 60)
  console.log("RemovalReason stored", action);
}

type BanAction = {
  createdAt: string;
  user: string;
};

export function isBanAction(obj: unknown): obj is BanAction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "createdAt" in obj &&
    typeof obj.createdAt === "string" &&
    "user" in obj &&
    typeof obj.user === "string"
  );
}

export async function storeBan(ban: BanAction) {
  const score = Temporal.Instant.from(ban.createdAt).epochMilliseconds;
  await redis.zAdd(`user:${ban.user}:ban`, {
    score: score,
    member: JSON.stringify(ban),
  });
  await redis.expire(`user:${ban.user}:ban`, 366 * 24 * 60 * 60)
  console.log("Ban stored", ban);
}

async function getBanActions(user: string) {
  const since = Temporal.Now.instant().subtract(Temporal.Duration.from({months: 6})).epochMilliseconds;
  const bans = await redis.zRange(`user:${user}:ban`, since, -1);
  return bans.map((a) => JSON.parse(a.member)).filter(isBanAction);
}

async function getRemovalActions(user: string, since: number) {
  const removals = await redis.zRange(`user:${user}:removal`, since, -1);
  return removals.map((a) => JSON.parse(a.member)).filter(isRemovalAction);
}