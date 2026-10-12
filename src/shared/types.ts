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
