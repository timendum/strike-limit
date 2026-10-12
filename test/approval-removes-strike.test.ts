import { createDevvitTest } from "@devvit/test/server/vitest";
import { redis } from "@devvit/web/server";
import { expect } from "vitest";
import { isRemovalAction, type RemovalAction } from "../src/shared/types";
import {
  approveComment,
  ms,
  otherModAction,
  postModAction,
  removalReasonComment,
  stubReddit,
} from "./helpers";

/**
 * removal and approval -> removal gone.
 */
const test = createDevvitTest({
  settings: { "strikes-ban": "3", "span-days": 0 },
});

async function storedRemovals(user: string): Promise<RemovalAction[]> {
  const entries = await redis.zRange(`user:${user}:removal`, 0, "+inf", {
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
    .filter(isRemovalAction);
}

const user = "repenter";
const content = {
  user,
  commentId: "t1_abc",
  postId: "t3_xyz",
  createdAt: ms("2026-02-01T09:00:00Z"),
};

test("approving removed content clears the recorded strike", async () => {
  stubReddit();

  const removeStatus = await postModAction(
    removalReasonComment({ ...content, actionedAt: "2026-02-01T10:00:00Z" }),
  );
  expect(removeStatus).toBe("success");
  expect(await storedRemovals(user)).toHaveLength(1);

  // Same target.id + createdAt
  const approveStatus = await postModAction(
    approveComment({ ...content, actionedAt: "2026-02-02T10:00:00Z" }),
  );
  expect(approveStatus).toBe("success");

  expect(await storedRemovals(user)).toHaveLength(0);
});

test("approving content that was never removed leaves other strikes intact", async () => {
  stubReddit();

  await postModAction(
    removalReasonComment({ ...content, actionedAt: "2026-02-01T10:00:00Z" }),
  );

  // Different target.id
  const approveStatus = await postModAction(
    approveComment({
      ...content,
      commentId: "t1_different",
      actionedAt: "2026-02-02T10:00:00Z",
    }),
  );
  expect(approveStatus).toBe("success");

  const remaining = await storedRemovals(user);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].target.id).toBe("t1_abc");
});

test("an unrelated mod action is skipped", async () => {
  stubReddit();

  const status = await postModAction(
    otherModAction({ action: "sticky", user, actionedAt: "2026-02-01T10:00:00Z" }),
  );

  expect(status).toBe("skipped");
  expect(await storedRemovals(user)).toHaveLength(0);
});
