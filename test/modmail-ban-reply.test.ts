import { createDevvitTest } from "@devvit/test/server/vitest";
import { redis } from "@devvit/web/server";
import { expect } from "vitest";

import {
  approveComment,
  modMailReplyRequest,
  ms,
  postModAction,
  postModMail,
  removalReasonComment,
  replyConversation,
  setConversation,
  stubReddit,
  type RedditStubs,
} from "./helpers";

const CONV = "abc123";
const MOD = "goodmod";

function removal(user: string, iso: string, id: string) {
  return removalReasonComment({
    user,
    commentId: id,
    postId: "t3_post",
    createdAt: ms(iso),
    actionedAt: iso,
  });
}

/** Reach the limit (2 strikes) for `user`, producing a notification. */
async function reachLimit(user: string) {
  await postModAction(removal(user, "2026-08-01T10:00:00Z", "t1_r1"));
  await postModAction(removal(user, "2026-08-02T10:00:00Z", "t1_r2"));
}

async function reply(stubs: RedditStubs, body: string, author = MOD, messageId = "m1") {
  setConversation(stubs, replyConversation({ conversationId: CONV, messageId, author, body }));
  return postModMail(modMailReplyRequest({ conversationId: CONV, messageId }));
}

function replies(stubs: RedditStubs): string[] {
  return stubs.reply.mock.calls.map((c) => (c[0] as { body: string }).body);
}

const noBanSettings = {
  "strikes-ban": "2",
  "ban-duration": "7",
  "span-days": 0,
  "do-ban": false,
  "ban-text": "Banned {user}\n{list}",
  "ban-entry": "- {date}",
};

const noBanTest = createDevvitTest({ settings: noBanSettings });

noBanTest("notification offers the reply option and stores the mapping", async () => {
  const stubs = stubReddit();
  await reachLimit("spammer");

  expect(stubs.createConversation).toHaveBeenCalledTimes(1);
  const body = (stubs.createConversation.mock.calls[0][0] as { body: string }).body;
  expect(body).toContain('reply "ban"');
  expect(body).toContain("for 7 days");
  expect(body.indexOf('reply "ban"')).toBeLessThan(body.indexOf("Ban message follows"));

  const mapping = await redis.hGetAll(`modmail:${CONV}`);
  expect(mapping.user).toBe("spammer");
  expect(mapping.duration).toBe("7");
});

noBanTest("a moderator replying ' BaN ' bans the user and confirms", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  await reachLimit("spammer");

  expect(await reply(stubs, "  BaN \n")).toBe("success");

  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  const ban = stubs.banUser.mock.calls[0][0];
  expect(ban.username).toBe("spammer");
  expect(ban.duration).toBe(7);
  expect(ban.message).toContain("Banned spammer");
  expect(ban.message).toContain("2026-08-01");
  expect(replies(stubs)).toEqual(["user banned: u/spammer is banned for 7 days."]);
  expect((await redis.hGetAll(`modmail:${CONV}`)).handled).toBe("1");
});

noBanTest("other bodies are ignored", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  await reachLimit("spammer");

  expect(await reply(stubs, "ban please")).toBe("skipped");
  expect(await reply(stubs, "bann")).toBe("skipped");
  expect(stubs.banUser).not.toHaveBeenCalled();
  expect(stubs.reply).not.toHaveBeenCalled();
});

noBanTest("ignores non-mods, mods without Users permission and the app", async () => {
  const stubs = stubReddit({
    moderators: ["flairmod", "strike-limit"],
    modPermissions: { flairmod: ["flair", "mail"] },
  });
  await reachLimit("spammer");

  expect(await reply(stubs, "ban", "randomuser")).toBe("skipped");
  expect(await reply(stubs, "ban", "flairmod")).toBe("skipped");
  expect(await reply(stubs, "ban", "strike-limit")).toBe("skipped");
  expect(stubs.banUser).not.toHaveBeenCalled();
  expect(stubs.reply).not.toHaveBeenCalled();
});

noBanTest("a moderator with the access permission is accepted", async () => {
  const stubs = stubReddit({ moderators: ["usermod"], modPermissions: { usermod: ["access"] } });
  await reachLimit("spammer");

  expect(await reply(stubs, "ban", "usermod")).toBe("success");
  expect(stubs.banUser).toHaveBeenCalledTimes(1);
});

noBanTest("conversations without a mapping are ignored", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  setConversation(
    stubs,
    replyConversation({ conversationId: "other", messageId: "m1", author: MOD, body: "ban" }),
  );

  const request = modMailReplyRequest({ conversationId: "other", messageId: "m1" });
  expect(await postModMail(request)).toBe("skipped");
  expect(stubs.banUser).not.toHaveBeenCalled();
});

noBanTest("handled conversations ignore later replies; no double ban", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  await reachLimit("spammer");

  expect(await reply(stubs, "ban")).toBe("success");
  expect(await reply(stubs, "ban")).toBe("skipped");
  expect(await reply(stubs, "ban", MOD, "m2")).toBe("skipped");
  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  expect(stubs.reply).toHaveBeenCalledTimes(1);
});

noBanTest("an already banned user is not banned again", async () => {
  const stubs = stubReddit({ moderators: [MOD], bannedUsers: ["spammer"] });
  await reachLimit("spammer");

  expect(await reply(stubs, "ban")).toBe("success");
  expect(stubs.banUser).not.toHaveBeenCalled();
  expect(replies(stubs)[0]).toContain("already banned");
  expect((await redis.hGetAll(`modmail:${CONV}`)).handled).toBe("1");
});

noBanTest("no ban when approvals brought the user below the limit", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  await reachLimit("spammer");
  await postModAction(
    approveComment({
      user: "spammer",
      commentId: "t1_r2",
      postId: "t3_post",
      createdAt: ms("2026-08-02T10:00:00Z"),
      actionedAt: "2026-08-03T10:00:00Z",
    }),
  );

  expect(await reply(stubs, "ban")).toBe("success");
  expect(stubs.banUser).not.toHaveBeenCalled();
  expect(replies(stubs)[0]).toContain("was not banned");
  const mapping = await redis.hGetAll(`modmail:${CONV}`);
  expect(mapping.handled).toBeUndefined();
  expect(mapping.lock).toBeUndefined();
});

noBanTest("a failing ban is reported and the conversation marked handled", async () => {
  const stubs = stubReddit({ moderators: [MOD] });
  stubs.banUser.mockRejectedValueOnce(new Error("boom"));
  await reachLimit("spammer");

  expect(await reply(stubs, "ban")).toBe("success");
  expect(replies(stubs)[0]).toContain("boom");
  expect((await redis.hGetAll(`modmail:${CONV}`)).handled).toBe("1");
});

const approvedTest = createDevvitTest({
  settings: {
    ...noBanSettings,
    "do-ban": true,
    "ignore-approved": true,
    "ban-duration": "0",
  },
});

approvedTest("approved-user notification offers a permanent ban", async () => {
  const stubs = stubReddit({ moderators: [MOD], approvedUsers: ["friend"] });
  await reachLimit("friend");

  expect(stubs.banUser).not.toHaveBeenCalled();
  const body = (stubs.createConversation.mock.calls[0][0] as { body: string }).body;
  expect(body).toContain('reply "ban"');
  expect(body).toContain("permanently");

  expect(await reply(stubs, "ban")).toBe("success");
  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  expect(stubs.banUser.mock.calls[0][0].duration).toBeUndefined();
  expect(replies(stubs)).toEqual(["user banned: u/friend is banned permanently."]);
});

approvedTest("moderator notification has no reply option and no mapping", async () => {
  const stubs = stubReddit({ moderators: [MOD, "badmod"] });
  await reachLimit("badmod");

  const body = (stubs.createConversation.mock.calls[0][0] as { body: string }).body;
  expect(body).not.toContain('reply "ban"');
  expect(await redis.hGetAll(`modmail:${CONV}`)).toEqual({});

  expect(await reply(stubs, "ban")).toBe("skipped");
  expect(stubs.banUser).not.toHaveBeenCalled();
});
