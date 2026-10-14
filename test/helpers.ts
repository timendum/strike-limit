import { reddit } from "@devvit/web/server";
import type { OnModActionRequest, OnModMailRequest } from "@devvit/web/shared";
import { Temporal } from "temporal-polyfill";
import { vi } from "vitest";

import { settings as settingsRoutes } from "../src/server/routes/settings";
import { triggers } from "../src/server/routes/triggers";

/**
 * Shared test helpers for the strike-limit suite.
 *
 */

const SUBREDDIT = {
  id: "t5_4amb3y",
  name: "test_subreddit",
  permalink: "/r/test_subreddit",
};

const MODERATOR = {
  id: "t2_5snbs",
  name: "timendum",
};

/* -------------------------------------------------------------------------- */
/* HTTP drivers                                                               */
/* -------------------------------------------------------------------------- */

async function postJson(
  app: { request: typeof triggers.request },
  path: string,
  payload: unknown,
): Promise<{ status?: string; success?: boolean; error?: string }> {
  const res = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<{
    status?: string;
    success?: boolean;
    error?: string;
  }>;
}

/** POST a mod-action payload to /mod-action; returns the TriggerResponse status. */
export async function postModAction(payload: unknown): Promise<string> {
  const json = await postJson(triggers, "/mod-action", payload);
  return json.status as string;
}

/** POST a mod-mail payload to /mod-mail; returns the TriggerResponse status. */
export async function postModMail(payload: unknown): Promise<string> {
  const json = await postJson(triggers, "/mod-mail", payload);
  return json.status as string;
}

/** POST a settings value to a validation endpoint; returns the response. */
export async function postSettings(
  key: string,
  value: unknown,
): Promise<{ success: boolean; error?: string }> {
  const json = await postJson(settingsRoutes, `/${key}`, { value });
  return json as { success: boolean; error?: string };
}

/* -------------------------------------------------------------------------- */
/* Reddit stubs                                                               */
/* -------------------------------------------------------------------------- */

/** Build a Listing-like object exposing `.all()` as the app expects. */
function listing<T>(items: T[]): { all: () => Promise<T[]> } {
  return { all: () => Promise.resolve(items) };
}

export type RedditStubOptions = {
  subredditName?: string;
  appUsername?: string;
  approvedUsers?: string[];
  moderators?: string[];
  bannedUsers?: string[];
};

export type RedditStubs = {
  banUser: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
};

/**
 * Install spies for every Reddit method the strike-limit core touches and
 * return the mock fns so individual tests can assert on them.
 */
export function stubReddit(opts: RedditStubOptions = {}): RedditStubs {
  const {
    subredditName = SUBREDDIT.name,
    appUsername = "strike-limit",
    approvedUsers = [],
    moderators = [],
    bannedUsers = [],
  } = opts;

  vi.spyOn(reddit, "getCurrentSubreddit").mockResolvedValue({
    name: subredditName,
  } as Awaited<ReturnType<typeof reddit.getCurrentSubreddit>>);

  vi.spyOn(reddit, "getAppUser").mockResolvedValue({
    username: appUsername,
  } as Awaited<ReturnType<typeof reddit.getAppUser>>);

  vi.spyOn(reddit, "getApprovedUsers").mockImplementation(
    ({ username }: { username?: string }) =>
      listing(username && approvedUsers.includes(username) ? [{ username }] : []) as ReturnType<
        typeof reddit.getApprovedUsers
      >,
  );

  vi.spyOn(reddit, "getModerators").mockImplementation(
    ({ username }: { username?: string }) =>
      listing(username && moderators.includes(username) ? [{ username }] : []) as ReturnType<
        typeof reddit.getModerators
      >,
  );

  vi.spyOn(reddit, "getBannedUsers").mockImplementation(
    ({ username }: { username?: string }) =>
      listing(username && bannedUsers.includes(username) ? [{ username }] : []) as ReturnType<
        typeof reddit.getBannedUsers
      >,
  );

  const banUser = vi.spyOn(reddit, "banUser").mockResolvedValue(undefined) as unknown as ReturnType<
    typeof vi.fn
  >;

  // reddit.modMail is a getter returning a ModMailService instance. Grab it
  // once and spy on the stable instance.
  const modMail = reddit.modMail;
  const createConversation = vi
    .spyOn(modMail, "createConversation")
    .mockResolvedValue({} as never) as unknown as ReturnType<typeof vi.fn>;
  const reply = vi.spyOn(modMail, "reply").mockResolvedValue({} as never) as unknown as ReturnType<
    typeof vi.fn
  >;
  const getConversation = vi
    .spyOn(modMail, "getConversation")
    .mockResolvedValue({} as never) as unknown as ReturnType<typeof vi.fn>;

  return { banUser, createConversation, reply, getConversation };
}

/** Point the stubbed modMail.getConversation at a conversation fixture. */
export function setConversation(stubs: RedditStubs, conversation: unknown) {
  stubs.getConversation.mockResolvedValue({ conversation } as never);
}

/* -------------------------------------------------------------------------- */
/* Payload builders                                 */
/* -------------------------------------------------------------------------- */

/** Epoch-ms for an ISO string, matching how the app scores Redis members. */
export function ms(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

type ActionBase = { action: string; actionedAt: string };

function modActionEnvelope(base: ActionBase, user: string) {
  return {
    ...base,
    subreddit: SUBREDDIT,
    moderator: MODERATOR,
    targetUser: { id: "t2_target", name: user },
    type: "ModAction",
  };
}

/** `addremovalreason` for a comment */
export function removalReasonComment(params: {
  user: string;
  commentId: string;
  postId: string;
  createdAt: number;
  actionedAt: string;
}): OnModActionRequest {
  return {
    ...modActionEnvelope(
      { action: "addremovalreason", actionedAt: params.actionedAt },
      params.user,
    ),
    targetComment: {
      id: params.commentId,
      parentId: params.postId,
      postId: params.postId,
      createdAt: params.createdAt,
      author: "t2_target",
      body: "removed comment body",
      subredditId: SUBREDDIT.id,
      permalink: `/r/test_subreddit/comments/${params.postId.slice(3)}/comment/${params.commentId.slice(3)}/`,
    },
  } as unknown as OnModActionRequest;
}

/** `addremovalreason` for a post. */
export function removalReasonPost(params: {
  user: string;
  postId: string;
  createdAt: number;
  actionedAt: string;
}): OnModActionRequest {
  return {
    ...modActionEnvelope(
      { action: "addremovalreason", actionedAt: params.actionedAt },
      params.user,
    ),
    targetPost: {
      id: params.postId,
      createdAt: params.createdAt,
      authorId: "t2_target",
      title: "removed post title",
      selftext: "removed post body",
      subredditId: SUBREDDIT.id,
      permalink: `/r/test_subreddit/comments/${params.postId.slice(3)}/removed_post/`,
    },
  } as unknown as OnModActionRequest;
}

/** `approvecomment` matching a comment removal. */
export function approveComment(params: {
  user: string;
  commentId: string;
  postId: string;
  createdAt: number;
  actionedAt: string;
}): OnModActionRequest {
  return {
    ...modActionEnvelope({ action: "approvecomment", actionedAt: params.actionedAt }, params.user),
    targetComment: {
      id: params.commentId,
      parentId: params.postId,
      postId: params.postId,
      createdAt: params.createdAt,
      author: "t2_target",
      body: "approved comment body",
      subredditId: SUBREDDIT.id,
      permalink: `/r/test_subreddit/comments/${params.postId.slice(3)}/comment/${params.commentId.slice(3)}/`,
    },
  } as unknown as OnModActionRequest;
}

/** `banuser` mod-action, issued by some moderator/bot (as in production). */
export function banUserAction(params: { user: string; actionedAt: string }): OnModActionRequest {
  return modActionEnvelope(
    { action: "banuser", actionedAt: params.actionedAt },
    params.user,
  ) as unknown as OnModActionRequest;
}

/** `unbanuser` mod-action, issued by some moderator (as in production). */
export function unbanUserAction(params: { user: string; actionedAt: string }): OnModActionRequest {
  return modActionEnvelope(
    { action: "unbanuser", actionedAt: params.actionedAt },
    params.user,
  ) as unknown as OnModActionRequest;
}

/** An arbitrary unhandled mod-action (e.g. "sticky"). */
export function otherModAction(params: {
  action: string;
  user: string;
  actionedAt: string;
}): OnModActionRequest {
  return modActionEnvelope(
    { action: params.action, actionedAt: params.actionedAt },
    params.user,
  ) as unknown as OnModActionRequest;
}

/** Internal, new, non-auto-generated mod-mail (a strike query from a mod). */
export function modMailRequest(params: { conversationId: string }): OnModMailRequest {
  return {
    conversationId: params.conversationId,
    messageId: "ModmailMessage_test",
    isAutoGenerated: false,
    conversationType: "internal",
    conversationState: "new",
    conversationSubreddit: SUBREDDIT,
    type: "ModMail",
  } as unknown as OnModMailRequest;
}

/** An auto-generated sr_user mod-mail (ban notification), which must be skipped. */
export function autoModMailRequest(params: { conversationId: string }): OnModMailRequest {
  return {
    conversationId: params.conversationId,
    messageId: "ModmailMessage_auto",
    isAutoGenerated: true,
    conversationType: "sr_user",
    conversationState: "archived",
    conversationSubreddit: SUBREDDIT,
    type: "ModMail",
  } as unknown as OnModMailRequest;
}
