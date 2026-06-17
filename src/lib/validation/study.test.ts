import { describe, expect, it } from "vitest";
import { studyDueQuerySchema } from "./study";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("studyDueQuerySchema", () => {
  it("applies defaults for limit and includeFuturePreview", () => {
    const result = studyDueQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.includeFuturePreview).toBe(false);
      expect(result.data.deckId).toBeUndefined();
      expect(result.data.cursor).toBeUndefined();
    }
  });

  it("coerces a string limit to an integer", () => {
    const result = studyDueQuerySchema.safeParse({ limit: "5" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
    }
  });

  it("accepts a limit of exactly 100", () => {
    const result = studyDueQuerySchema.safeParse({ limit: "100" });
    expect(result.success).toBe(true);
  });

  it("rejects a limit above 100", () => {
    const result = studyDueQuerySchema.safeParse({ limit: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects a limit below 1", () => {
    const result = studyDueQuerySchema.safeParse({ limit: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer limit", () => {
    const result = studyDueQuerySchema.safeParse({ limit: "5.5" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID deckId", () => {
    const result = studyDueQuerySchema.safeParse({ deckId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deckId).toBe(VALID_UUID);
    }
  });

  it("rejects an invalid UUID deckId", () => {
    const result = studyDueQuerySchema.safeParse({ deckId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty cursor", () => {
    const result = studyDueQuerySchema.safeParse({ cursor: "" });
    expect(result.success).toBe(false);
  });

  it.each([
    ["true", true],
    ["1", true],
    ["TRUE", true],
    ["false", false],
    ["0", false],
    ["False", false],
  ])("parses includeFuturePreview=%s as %s", (input, expected) => {
    const result = studyDueQuerySchema.safeParse({ includeFuturePreview: input });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeFuturePreview).toBe(expected);
    }
  });

  it("rejects a non-boolean includeFuturePreview", () => {
    const result = studyDueQuerySchema.safeParse({ includeFuturePreview: "maybe" });
    expect(result.success).toBe(false);
  });

  it("ignores unknown query parameters", () => {
    const result = studyDueQuerySchema.safeParse({ foo: "bar", limit: "10" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect("foo" in result.data).toBe(false);
    }
  });
});
