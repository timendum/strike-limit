import { createDevvitTest } from "@devvit/test/server/vitest";
import { expect } from "vitest";

import { banUserAction, ms, postModAction, removalReasonComment, stubReddit } from "./helpers";

/**
 * removal, ban, removal -> only the last removal counts
 */
const test = createDevvitTest({
  settings: {
    "strikes-ban": "2",
    "ban-duration": "7",
    "span-days": 0,
    "ban-text": "Banned {user}\n{list}",
    "ban-entry": "- {date}",
  },
});

function removal(user: string, iso: string, id: string) {
  return removalReasonComment({
    user,
    commentId: id,
    postId: "t3_post",
    createdAt: ms(iso),
    actionedAt: iso,
  });
}

test("only removals after the last ban count toward the next ban", async () => {
  const stubs = stubReddit();
  const user = "recidivist";

  // 01. One removal
  await postModAction(removal(user, "2026-03-01T10:00:00Z", "t1_pre1"));
  expect(stubs.banUser).not.toHaveBeenCalled();

  // 05. Manual ban
  expect(await postModAction(banUserAction({ user, actionedAt: "2026-03-05T12:00:00Z" }))).toBe(
    "success",
  );

  // 10. New removal
  await postModAction(removal(user, "2026-03-10T10:00:00Z", "t1_post1"));
  expect(stubs.banUser).not.toHaveBeenCalled();

  // 11. New removal, now reaches strike-limit
  await postModAction(removal(user, "2026-03-11T10:00:00Z", "t1_post2"));

  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  const arg = stubs.banUser.mock.calls[0][0];
  expect(arg.username).toBe(user);
  expect(arg.note).toContain("1 previous bans");
  expect(arg.note).toContain("2 removals");
});
