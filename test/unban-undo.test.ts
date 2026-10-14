import { createDevvitTest } from "@devvit/test/server/vitest";
import { redis } from "@devvit/web/server";
import { expect, test as vitestTest } from "vitest";

import { type BanAction, isBanAction, isNoBanAction, type NoBanAction } from "../src/shared/types";
import { banUserAction, postModAction, stubReddit, unbanUserAction } from "./helpers";

/**
 * A moderator undoing a ban within 24h should drop the ban from `:ban`
 * (so it stops counting toward escalation) and record it on `:noBan` with
 * `from: "unban"`.
 */
const test = createDevvitTest({
  settings: { "strikes-ban": "3", "span-days": 0 },
});

async function storedBans(user: string): Promise<BanAction[]> {
  const entries = await redis.zRange(`user:${user}:ban`, 0, "+inf", {
    by: "score",
  });
  return entries
    .map((e) => {
      try {
        return JSON.parse(e.member) as unknown;
      } catch {
        return null;
      }
    })
    .filter(isBanAction);
}

async function storedNoBans(user: string): Promise<NoBanAction[]> {
  const entries = await redis.zRange(`user:${user}:noBan`, 0, "+inf", {
    by: "score",
  });
  return entries
    .map((e) => {
      try {
        return JSON.parse(e.member) as unknown;
      } catch {
        return null;
      }
    })
    .filter(isNoBanAction);
}

test('unban within 24h removes the ban and records a from:"unban" noBan', async () => {
  stubReddit();
  const user = "undone";

  expect(await postModAction(banUserAction({ user, actionedAt: "2026-04-01T10:00:00Z" }))).toBe(
    "success",
  );
  expect(await storedBans(user)).toHaveLength(1);

  const unbanIso = "2026-04-01T11:00:00Z"; // +1h
  expect(await postModAction(unbanUserAction({ user, actionedAt: unbanIso }))).toBe("success");

  expect(await storedBans(user)).toHaveLength(0);
  const noBans = await storedNoBans(user);
  expect(noBans).toHaveLength(1);
  expect(noBans[0].from).toBe("unban");
  expect(noBans[0].createdAt).toBe(unbanIso);
});

test("unban at exactly 24h leaves the ban in place and records nothing", async () => {
  stubReddit();
  const user = "boundary";

  await postModAction(banUserAction({ user, actionedAt: "2026-04-01T10:00:00Z" }));
  expect(
    await postModAction(
      unbanUserAction({ user, actionedAt: "2026-04-02T10:00:00Z" }), // +24h
    ),
  ).toBe("success");

  expect(await storedBans(user)).toHaveLength(1);
  expect(await storedNoBans(user)).toHaveLength(0);
});

test("unban more than 24h later leaves the ban in place and records nothing", async () => {
  stubReddit();
  const user = "stale";

  await postModAction(banUserAction({ user, actionedAt: "2026-04-01T10:00:00Z" }));
  await postModAction(
    unbanUserAction({ user, actionedAt: "2026-04-02T11:00:00Z" }), // +25h
  );

  expect(await storedBans(user)).toHaveLength(1);
  expect(await storedNoBans(user)).toHaveLength(0);
});

test("unban with no matching ban is a no-op but still handled", async () => {
  stubReddit();
  const user = "neverbanned";

  expect(await postModAction(unbanUserAction({ user, actionedAt: "2026-04-01T10:00:00Z" }))).toBe(
    "success",
  );

  expect(await storedBans(user)).toHaveLength(0);
  expect(await storedNoBans(user)).toHaveLength(0);
});

test("the most recent qualifying ban is the one removed", async () => {
  stubReddit();
  const user = "doublebanned";

  await postModAction(banUserAction({ user, actionedAt: "2026-04-01T10:00:00Z" }));
  await postModAction(banUserAction({ user, actionedAt: "2026-04-01T12:00:00Z" })); // +2h
  expect(await storedBans(user)).toHaveLength(2);

  await postModAction(
    unbanUserAction({ user, actionedAt: "2026-04-01T13:00:00Z" }), // +3h
  );

  const bans = await storedBans(user);
  expect(bans).toHaveLength(1);
  expect(bans[0].createdAt).toBe("2026-04-01T10:00:00Z"); // older ban retained

  const noBans = await storedNoBans(user);
  expect(noBans).toHaveLength(1);
  expect(noBans[0].from).toBe("unban");
});

/* -------------------------------------------------------------------------- */
/* isNoBanAction guard coverage                                               */
/* -------------------------------------------------------------------------- */

vitestTest("isNoBanAction accepts both notification and unban origins", () => {
  const base = { createdAt: "2026-04-01T10:00:00Z", user: "u" };
  expect(isNoBanAction({ ...base, from: "unban" })).toBe(true);
  expect(isNoBanAction({ ...base, from: "notification" })).toBe(true);
  expect(isNoBanAction({ ...base, from: "something-else" })).toBe(false);
  expect(isNoBanAction({ ...base })).toBe(false);
  expect(isNoBanAction({ ...base, from: 42 })).toBe(false);
});
