import { createDevvitTest } from "@devvit/test/server/vitest";
import { expect } from "vitest";
import {
  ms,
  postModAction,
  removalReasonComment,
  stubReddit,
} from "./helpers";

/**
 * multiple removals -> ban
 */
const test = createDevvitTest({
  settings: {
    "strikes-ban": "3",
    "ban-duration": "7",
    "span-days": 0,
    "no-ban": false,
    "ignore-approved": false,
    "ban-text": "Banned {user}: {removedNumber} removals\n{list}",
    "ban-entry": "- {date} {kind} {permalink}",
  },
});

function removal(user: string, n: number) {
  return removalReasonComment({
    user,
    commentId: `t1_c${n}`,
    postId: `t3_p${n}`,
    createdAt: ms(`2026-01-0${n}T09:00:00Z`),
    actionedAt: `2026-01-0${n}T10:00:00Z`,
  });
}

test("bans a user after reaching the strike threshold", async () => {
  const stubs = stubReddit();
  const user = "spammer";

  expect(await postModAction(removal(user, 1))).toBe("success");
  expect(await postModAction(removal(user, 2))).toBe("success");
  expect(stubs.banUser).not.toHaveBeenCalled();

  expect(await postModAction(removal(user, 3))).toBe("success");

  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  const arg = stubs.banUser.mock.calls[0][0];
  expect(arg.username).toBe(user);
  expect(arg.duration).toBe(7);
  expect(arg.message).toContain("removals");
});

test("does not ban again on a duplicate removal", async () => {
  const stubs = stubReddit();
  const user = "dupuser";

  await postModAction(removal(user, 1));
  await postModAction(removal(user, 2));
  await postModAction(removal(user, 3));
  expect(stubs.banUser).toHaveBeenCalledTimes(1);

  // Duplicated removal.
  await postModAction(removal(user, 3));
  expect(stubs.banUser).toHaveBeenCalledTimes(1);
});

// A separate instance with ignore-approved enabled: approved users should be
// notified via ModMail instead of banned.
const ignoreApprovedTest = createDevvitTest({
  settings: {
    "strikes-ban": "3",
    "ban-duration": "7",
    "span-days": 0,
    "no-ban": false,
    "ignore-approved": true,
    "ban-text": "Banned {user}\n{list}",
    "ban-entry": "- {date} {kind} {permalink}",
  },
});

ignoreApprovedTest(
  "notifies instead of banning an approved user when ignore-approved is on",
  async () => {
    const stubs = stubReddit({ approvedUsers: ["trusted"] });
    const user = "trusted";

    await postModAction(removal(user, 1));
    await postModAction(removal(user, 2));
    await postModAction(removal(user, 3));

    expect(stubs.banUser).not.toHaveBeenCalled();
    expect(stubs.createConversation).toHaveBeenCalledTimes(1);
    const conv = stubs.createConversation.mock.calls[0][0];
    expect(conv.subject).toContain("approved");
    expect(conv.to).toBeNull();
  },
);
