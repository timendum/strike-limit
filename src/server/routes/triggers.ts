import { Hono } from "hono";
import type {
  OnAppInstallRequest,
  OnModActionRequest,
  TriggerResponse,
} from "@devvit/web/shared";
import {
  isBanAction,
  isRemovalAction,
  storeBan,
  storeRemovalAction,
} from "../core/strikes";

export const triggers = new Hono();

triggers.post("/app-install", async (c) => {
  // url from devvit triggers.onAppInstall
  const input = await c.req.json<OnAppInstallRequest>();
  console.log("App installed to subreddit: r/" + input.subreddit?.name);

  return c.json<TriggerResponse>(
    {
      status: "success",
    },
    200
  );
});

triggers.post("/app-upgrade", async (c) => {
  // url from devvit triggers.onAppUpgrade
  const input = await c.req.json<OnAppInstallRequest>();
  console.log("App upgraded to subreddit: r/" + input.subreddit?.name);
  return c.json<TriggerResponse>(
    {
      status: "success",
    },
    200
  );
});

function handleAddRemovalReason(input: OnModActionRequest) {
  if (input.action !== "addremovalreason") {
    return false;
  }
  let action = undefined;
  if (input.targetComment) {
    action = {
      createdAt: input.actionedAt,
      target: {
        id: input.targetComment.id,
        author: input.targetUser?.name,
        createdAt: input.targetComment.createdAt,
        postId: input.targetComment.postId,
      },
    };
  } else if (input.targetPost) {
    action = {
      createdAt: input.actionedAt,
      target: {
        id: input.targetPost.id,
        author: input.targetUser?.name,
        createdAt: input.targetPost.createdAt,
        postId: input.targetPost.id,
      },
    };
  }
  if (isRemovalAction(action)) {
    storeRemovalAction(action);
    return true;
  } else {
    console.error("RemovalReason not handled", input, action);}
  return false;
}

function handleBan(input: OnModActionRequest) {
  if (input.action !== "banuser") {
    return false;
  }
  const ban = {
    createdAt: input.actionedAt,
    user: input.targetUser?.name,
  };
  if (isBanAction(ban)) {
    storeBan(ban);
    return true;
  } else {
    console.error("Ban not handled", input, ban);
  }
  return false;
}

triggers.post("/mod-action", async (c) => {
  // url from devvit triggers.onModAction
  const input = await c.req.json<OnModActionRequest>();
  // console.log("new mod action:", input);
  if (handleAddRemovalReason(input) || handleBan(input)) {
    return c.json<TriggerResponse>(
      {
        status: "success",
      },
      200
    );
  }
  return c.json<TriggerResponse>(
    {
      status: "skipped",
    },
    200
  );
});
