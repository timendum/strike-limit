export type RemovalAction = {
  createdAt: string;
  modType: "mod";
  target: {
    id: string;
    createdAt: number;
    author: string;
    postId: string;
  };
};

export function isRemovalAction(obj: unknown): obj is RemovalAction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "createdAt" in obj &&
    typeof obj.createdAt === "string" &&
    "modType" in obj &&
    typeof obj.modType === "string" &&
    obj.modType == "mod" &&
    "target" in obj &&
    typeof obj.target === "object" &&
    obj.target !== null &&
    "id" in obj.target &&
    typeof obj.target.id === "string" &&
    "createdAt" in obj.target &&
    typeof obj.target.createdAt === "number" &&
    "author" in obj.target &&
    typeof obj.target.author === "string" &&
    "postId" in obj.target &&
    typeof obj.target.postId === "string"
  );
}

export type BanAction = {
  createdAt: string;
  user: string;
};

export function isBanAction(obj: unknown): obj is BanAction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "createdAt" in obj &&
    typeof obj.createdAt === "string" &&
    "user" in obj &&
    typeof obj.user === "string"
  );
}

export type NoBanAction = {
  createdAt: string;
  user: string;
  from: "notification" | "unban";
};

export function isNoBanAction(obj: unknown): obj is NoBanAction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "createdAt" in obj &&
    typeof obj.createdAt === "string" &&
    "user" in obj &&
    typeof obj.user === "string" &&
    "from" in obj &&
    typeof obj.from === "string" &&
    (obj.from == "notification" || obj.from == "unban")
  );
}

/**
 * Link between a notification modmail conversation and the user it is about.
 * Stored in the Redis hash `modmail:{conversationId}`; all values are strings there.
 */
export type ModMailBanRequest = {
  user: string;
  /** Ban duration in days shown in the notification (0 = permanent). */
  duration: number;
  /** Epoch ms of the `noBan` entry written with the notification. */
  notifiedAt: number;
  handled: boolean;
};

/** Parse the raw `hGetAll` record of a `modmail:{conversationId}` hash. */
export function parseModMailBanRequest(obj: unknown): ModMailBanRequest | undefined {
  if (
    typeof obj !== "object" ||
    obj === null ||
    !("user" in obj) ||
    typeof obj.user !== "string" ||
    obj.user.length === 0 ||
    !("duration" in obj) ||
    typeof obj.duration !== "string" ||
    !("notifiedAt" in obj) ||
    typeof obj.notifiedAt !== "string"
  ) {
    return undefined;
  }
  const duration = Number(obj.duration);
  const notifiedAt = Number(obj.notifiedAt);
  if (!Number.isInteger(duration) || duration < 0 || !Number.isFinite(notifiedAt)) {
    return undefined;
  }
  const handled = "handled" in obj && obj.handled === "1";
  return { user: obj.user, duration, notifiedAt, handled };
}
