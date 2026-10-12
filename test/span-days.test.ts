import { createDevvitTest } from "@devvit/test/server/vitest";
import { expect } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
  ms,
  postModAction,
  removalReasonComment,
  stubReddit,
} from "./helpers";

/**
 * span-days > 0
 */

// 30-day window.
const test = createDevvitTest({
  settings: {
    "strikes-ban": "3",
    "ban-duration": "7",
    "span-days": 30,
    "ban-text": "Banned {user}\n{list}",
    "ban-entry": "- {date}",
  },
});

/** ISO string for `days` ago. */
function daysAgo(days: number, hours = 0): string {
  return Temporal.Now.instant()
    .subtract({ hours: days * 24 + hours })
    .toString();
}

function removal(user: string, iso: string, id: string) {
  return removalReasonComment({
    user,
    commentId: id,
    postId: "t3_post",
    createdAt: ms(iso),
    actionedAt: iso,
  });
}

test("ignores removals older than the span-days window", async () => {
  const stubs = stubReddit();
  const user = "veteran";

  // Older then span-days
  await postModAction(removal(user, daysAgo(100), "t1_old"));
  // Ok for span-days
  await postModAction(removal(user, daysAgo(5, 2), "t1_new1"));
  await postModAction(removal(user, daysAgo(5, 1), "t1_new2"));

  // 2 < 3, no ban
  expect(stubs.banUser).not.toHaveBeenCalled();
});

test("bans when enough recent removals fall inside the window", async () => {
  const stubs = stubReddit();
  const user = "recent";

  await postModAction(removal(user, daysAgo(100), "t1_old"));
  await postModAction(removal(user, daysAgo(5, 3), "t1_n1"));
  await postModAction(removal(user, daysAgo(5, 2), "t1_n2"));
  expect(stubs.banUser).not.toHaveBeenCalled();

  // to ban
  await postModAction(removal(user, daysAgo(5, 1), "t1_n3"));

  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  // Count 3 removals
  expect(stubs.banUser.mock.calls[0][0].note).toContain("3 removals");
});
