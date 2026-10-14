import { createDevvitTest } from "@devvit/test/server/vitest";
import { expect } from "vitest";

import {
  autoModMailRequest,
  banUserAction,
  modMailRequest,
  ms,
  postModAction,
  postModMail,
  removalReasonComment,
  setConversation,
  stubReddit,
} from "./helpers";

/**
 * modmail response
 *
 * A mod sends an internal "strike query: <user>" conversation. Driven through
 * /mod-mail: handleModMailQuery filters (internal + new + not auto-generated),
 * replyModMailQuery parses the subject, looks up the user's removals and bans,
 * and replies with a formatted summary.
 */
const test = createDevvitTest();

function removal(user: string, iso: string, id: string) {
  return removalReasonComment({
    user,
    commentId: id,
    postId: "t3_post1",
    createdAt: ms(iso),
    actionedAt: iso,
  });
}

test("replies to a strike query with the user's recorded removals and bans", async () => {
  const stubs = stubReddit({ appUsername: "strike-limit" });
  const user = "troublemaker";

  // Stage history through the real trigger path.
  await postModAction(removal(user, "2026-04-01T10:00:00Z", "t1_a"));
  await postModAction(removal(user, "2026-04-02T10:00:00Z", "t1_b"));
  await postModAction(banUserAction({ user, actionedAt: "2026-04-03T10:00:00Z" }));

  setConversation(stubs, {
    subject: `strike query: ${user}`,
    authors: [{ name: "human_mod" }],
  });

  const status = await postModMail(modMailRequest({ conversationId: "ModmailConversation_q1" }));

  expect(status).toBe("success");
  expect(stubs.reply).toHaveBeenCalledTimes(1);
  const replyArg = stubs.reply.mock.calls[0][0];
  expect(replyArg.conversationId).toBe("ModmailConversation_q1");
  expect(replyArg.body).toContain("troublemaker");
  expect(replyArg.body).toContain("2026-04-01");
  expect(replyArg.body).toContain("2026-04-02");
  expect(replyArg.body).toContain("Recorded bans");
  expect(replyArg.body).toContain("2026-04-03");
});

test("reports no records for a user with a clean history", async () => {
  const stubs = stubReddit();
  setConversation(stubs, {
    subject: "strike query: cleanuser",
    authors: [{ name: "human_mod" }],
  });

  const status = await postModMail(modMailRequest({ conversationId: "ModmailConversation_q2" }));

  expect(status).toBe("success");
  const body = stubs.reply.mock.calls[0][0].body as string;
  expect(body).toContain("No recorded removed contents for u/cleanuser");
  expect(body).toContain("No recorded bans for u/cleanuser");
});

test("ignores its own mail to avoid reply loops", async () => {
  const stubs = stubReddit({ appUsername: "strike-limit" });
  setConversation(stubs, {
    subject: "strike query: someone",
    authors: [{ name: "strike-limit" }],
  });

  const status = await postModMail(modMailRequest({ conversationId: "ModmailConversation_q3" }));

  expect(status).toBe("skipped");
  expect(stubs.reply).not.toHaveBeenCalled();
});

test("skips conversations whose subject is not a strike query", async () => {
  const stubs = stubReddit();
  setConversation(stubs, {
    subject: "just a normal modmail",
    authors: [{ name: "human_mod" }],
  });

  const status = await postModMail(modMailRequest({ conversationId: "ModmailConversation_q4" }));

  expect(status).toBe("skipped");
  expect(stubs.reply).not.toHaveBeenCalled();
});

test("skips auto-generated sr_user mail (e.g. ban notifications)", async () => {
  const stubs = stubReddit();

  const status = await postModMail(
    autoModMailRequest({ conversationId: "ModmailConversation_auto" }),
  );

  expect(status).toBe("skipped");
  // Short-circuits before ever fetching the conversation.
  expect(stubs.getConversation).not.toHaveBeenCalled();
  expect(stubs.reply).not.toHaveBeenCalled();
});
