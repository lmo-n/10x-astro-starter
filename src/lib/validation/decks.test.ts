import { describe, expect, it } from "vitest";
import { createDeckSchema } from "./decks";

describe("createDeckSchema", () => {
  it("accepts a valid, non-empty name", () => {
    const result = createDeckSchema.safeParse({ name: "Biology 101" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Biology 101");
    }
  });

  it("trims surrounding whitespace from the name", () => {
    const result = createDeckSchema.safeParse({ name: "  Spanish  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Spanish");
    }
  });

  it("rejects a name that is empty after trimming", () => {
    const result = createDeckSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const result = createDeckSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a non-string name", () => {
    const result = createDeckSchema.safeParse({ name: 123 });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 100 characters", () => {
    const result = createDeckSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts a name of exactly 100 characters", () => {
    const result = createDeckSchema.safeParse({ name: "a".repeat(100) });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict schema)", () => {
    const result = createDeckSchema.safeParse({ name: "Math", user_id: "hacker" });
    expect(result.success).toBe(false);
  });
});
