import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT_PATH, isSafeRelativePath, safeRedirectPath, startGoogleOAuthQuerySchema } from "./auth";

describe("isSafeRelativePath", () => {
  it("accepts a simple relative path", () => {
    expect(isSafeRelativePath("/dashboard")).toBe(true);
  });

  it("accepts a relative path with query and fragment", () => {
    expect(isSafeRelativePath("/decks/123?tab=cards#top")).toBe(true);
  });

  it("rejects an absolute http(s) URL", () => {
    expect(isSafeRelativePath("https://evil.example.com")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isSafeRelativePath("//evil.example.com")).toBe(false);
  });

  it("rejects a backslash-escaped protocol-relative URL", () => {
    expect(isSafeRelativePath("/\\evil.example.com")).toBe(false);
  });

  it("rejects a path that does not start with a slash", () => {
    expect(isSafeRelativePath("dashboard")).toBe(false);
  });
});

describe("startGoogleOAuthQuerySchema", () => {
  it("defaults redirectTo to the dashboard when omitted", () => {
    const result = startGoogleOAuthQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirectTo).toBe(DEFAULT_REDIRECT_PATH);
    }
  });

  it("accepts a safe relative redirectTo", () => {
    const result = startGoogleOAuthQuerySchema.safeParse({ redirectTo: "/decks" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirectTo).toBe("/decks");
    }
  });

  it("rejects an absolute redirectTo", () => {
    const result = startGoogleOAuthQuerySchema.safeParse({ redirectTo: "https://evil.example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects a protocol-relative redirectTo", () => {
    const result = startGoogleOAuthQuerySchema.safeParse({ redirectTo: "//evil.example.com" });
    expect(result.success).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("returns a safe relative path unchanged", () => {
    expect(safeRedirectPath("/study")).toBe("/study");
  });

  it("falls back to the default for an unsafe path", () => {
    expect(safeRedirectPath("https://evil.example.com")).toBe(DEFAULT_REDIRECT_PATH);
  });

  it("falls back to the default for null", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT_PATH);
  });

  it("falls back to the default for undefined", () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT_PATH);
  });
});
