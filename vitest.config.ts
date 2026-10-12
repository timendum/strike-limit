import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test spins up its own isolated Devvit world via @devvit/test.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
