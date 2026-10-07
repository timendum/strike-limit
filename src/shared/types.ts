export type RemovalAction = {
  createdAt: string;
  modType: "mod" | "admin";
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
    (obj.modType == "mod" || obj.modType == "admin") &&
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
