import { createDevvitTest } from "@devvit/test/server/vitest";
import { expect } from "vitest";
import {
  banUserAction,
  ms,
  postModAction,
  removalReasonComment,
  stubReddit,
} from "./helpers";

function removal(user: string, iso: string, id: string) {
  return removalReasonComment({
    user,
    commentId: id,
    postId: "t3_post",
    createdAt: ms(iso),
    actionedAt: iso,
  });
}

/* -------------------------------------------------------------------------- */
/* different thresholds and durations
/* -------------------------------------------------------------------------- */

const escalationTest = createDevvitTest({
  settings: {
    "strikes-ban": "2;4",   // 2, then 4
    "ban-duration": "7;30", // 7, then 30
    "span-days": 0,
    "ban-text": "Banned {user}\n{list}",
    "ban-entry": "- {date}",
  },
});

escalationTest(
  "uses the next tier's threshold and duration for a repeat offense",
  async () => {
    const stubs = stubReddit();
    const user = "escalator";

    // First tier
    await postModAction(removal(user, "2026-05-01T10:00:00Z", "t1_a1"));
    await postModAction(removal(user, "2026-05-02T10:00:00Z", "t1_a2"));
    expect(stubs.banUser).toHaveBeenCalledTimes(1);
    expect(stubs.banUser.mock.calls[0][0].duration).toBe(7);

    // Record a ban (to mimic reddit notification of the ban).
    await postModAction(
      banUserAction({ user, actionedAt: "2026-05-02T10:00:05Z" }),
    );

    // Second tier
    await postModAction(removal(user, "2026-05-03T10:00:00Z", "t1_b1"));
    await postModAction(removal(user, "2026-05-04T10:00:00Z", "t1_b2"));
    await postModAction(removal(user, "2026-05-05T10:00:00Z", "t1_b3"));
    expect(stubs.banUser).toHaveBeenCalledTimes(1); // still only 3 strikes, < 4

    await postModAction(removal(user, "2026-05-06T10:00:00Z", "t1_b4"));

    expect(stubs.banUser).toHaveBeenCalledTimes(2);
    const secondBan = stubs.banUser.mock.calls[1][0];
    expect(secondBan.duration).toBe(30);
    expect(secondBan.note).toContain("1 previous bans");
    expect(secondBan.note).toContain("4 removals");
  },
);

escalationTest(
  "reuses the last tier when offenses exceed the configured list",
  async () => {
    const stubs = stubReddit();
    const user = "serial";

    // Simulate 2 bans
    await postModAction(
      banUserAction({ user, actionedAt: "2026-05-01T00:00:00Z" }),
    );
    await postModAction(
      banUserAction({ user, actionedAt: "2026-05-01T01:00:00Z" }),
    );

    // still use the second, last value
    for (let i = 1; i <= 4; i++) {
      await postModAction(
        removal(user, `2026-05-02T0${i}:00:00Z`, `t1_c${i}`),
      );
    }

    expect(stubs.banUser).toHaveBeenCalledTimes(1);
    expect(stubs.banUser.mock.calls[0][0].duration).toBe(30);
  },
);

/* -------------------------------------------------------------------------- */
/* ban-duration 0 -> permanent
/* -------------------------------------------------------------------------- */

const permaTest = createDevvitTest({
  settings: {
    "strikes-ban": "2",
    "ban-duration": "0",
    "span-days": 0,
    "ban-text": "Banned {user}",
    "ban-entry": "- {date}",
  },
});

permaTest("maps ban-duration 0 to a permanent ban (duration undefined)", async () => {
  const stubs = stubReddit();
  const user = "permauser";

  await postModAction(removal(user, "2026-06-01T10:00:00Z", "t1_p1"));
  await postModAction(removal(user, "2026-06-02T10:00:00Z", "t1_p2"));

  expect(stubs.banUser).toHaveBeenCalledTimes(1);
  expect(stubs.banUser.mock.calls[0][0].duration).toBeUndefined();
});

/* -------------------------------------------------------------------------- */
/* Already banned: no re-ban, no ModMail                                      */
/* -------------------------------------------------------------------------- */

const alreadyBannedTest = createDevvitTest({
  settings: {
    "strikes-ban": "2",
    "ban-duration": "7",
    "span-days": 0,
    "ban-text": "Banned {user}",
    "ban-entry": "- {date}",
  },
});

alreadyBannedTest(
  "skips silently when the user is already banned on the subreddit",
  async () => {
    const user = "alreadygone";
    const stubs = stubReddit({ bannedUsers: [user] });

    await postModAction(removal(user, "2026-07-01T10:00:00Z", "t1_x1"));
    await postModAction(removal(user, "2026-07-02T10:00:00Z", "t1_x2"));

    // Threshold reached, but the user is already banned: no new ban, no modmail.
    expect(stubs.banUser).not.toHaveBeenCalled();
    expect(stubs.createConversation).not.toHaveBeenCalled();
  },
);
