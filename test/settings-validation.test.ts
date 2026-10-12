import { describe, expect, it } from "vitest";
import { postSettings } from "./helpers";

/**
 * settings change and validation
 *
 * Driven through the real /internal/settings/<key> endpoints (the same ones
 * devvit.json points each setting's validationEndpoint at).
 */

describe("strikes-ban validation", () => {
  it("accepts a single positive integer", async () => {
    expect(await postSettings("strikes-ban", "3")).toEqual({ success: true });
  });

  it("accepts a ;-separated escalation list", async () => {
    expect(await postSettings("strikes-ban", "3;5;10")).toEqual({
      success: true,
    });
  });

  it("rejects an empty value", async () => {
    expect((await postSettings("strikes-ban", "")).success).toBe(false);
  });

  it("rejects zero (must be >= 1)", async () => {
    expect((await postSettings("strikes-ban", "0")).success).toBe(false);
  });

  it("rejects a non-integer entry in the list", async () => {
    const r = await postSettings("strikes-ban", "3;abc");
    expect(r.success).toBe(false);
    expect(r.error).toContain("abc");
  });
});

describe("ban-duration validation", () => {
  it("accepts 0 (permanent)", async () => {
    expect(await postSettings("ban-duration", "0")).toEqual({ success: true });
  });

  it("accepts a ;-separated day list", async () => {
    expect(await postSettings("ban-duration", "7;30;0")).toEqual({
      success: true,
    });
  });

  it("rejects a negative duration", async () => {
    expect((await postSettings("ban-duration", "-1")).success).toBe(false);
  });

  it("rejects an empty value", async () => {
    expect((await postSettings("ban-duration", "")).success).toBe(false);
  });
});

describe("span-days validation", () => {
  it("accepts 0 (max window)", async () => {
    expect(await postSettings("span-days", 0)).toEqual({ success: true });
  });

  it("accepts a value inside 0..365", async () => {
    expect(await postSettings("span-days", 90)).toEqual({ success: true });
  });

  it("rejects a negative value", async () => {
    expect((await postSettings("span-days", -5)).success).toBe(false);
  });

  it("rejects a value above 365", async () => {
    expect((await postSettings("span-days", 400)).success).toBe(false);
  });
});
