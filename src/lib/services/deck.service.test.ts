import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDeck, DeckServiceError, DECK_LIMIT } from "./deck.service";

interface PostgrestLikeError {
  message: string;
}

interface InsertResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

interface CountResult {
  count: number | null;
  error: PostgrestLikeError | null;
}

/**
 * Build a minimal mock that mimics the two Supabase query chains used by
 * `createDeck`:
 *   - insert: `.from().insert().select().single()`
 *   - count:  `.from().select(..., { head }).eq()`
 */
function makeSupabase(insertResult: InsertResult, countResult: CountResult) {
  const single = vi.fn().mockResolvedValue(insertResult);
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const eq = vi.fn().mockResolvedValue(countResult);
  const countSelect = vi.fn(() => ({ eq }));

  const from = vi.fn(() => ({ insert, select: countSelect }));

  const client = { from } as unknown as SupabaseClient;
  return { client, insert };
}

const VALID_ROW = {
  id: "deck-1",
  name: "Biology 101",
  created_at: "2026-06-12T10:00:00.000Z",
  updated_at: "2026-06-12T10:00:00.000Z",
};

describe("createDeck", () => {
  it("creates a deck and returns DeckDto with zeroed counters", async () => {
    const { client, insert } = makeSupabase({ data: VALID_ROW, error: null }, { count: 5, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", name: "Biology 101" });
    expect(result.deck).toEqual({
      id: "deck-1",
      name: "Biology 101",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:00.000Z",
      flashcardsCount: 0,
      dueFlashcardsCount: 0,
    });
    expect(result.limits).toEqual({
      deckCount: 5,
      deckLimit: DECK_LIMIT,
      canCreateDeck: true,
    });
  });

  it("reports canCreateDeck=false when the deck count reaches the limit", async () => {
    const { client } = makeSupabase({ data: VALID_ROW, error: null }, { count: DECK_LIMIT, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(result.limits.canCreateDeck).toBe(false);
    expect(result.limits.deckCount).toBe(DECK_LIMIT);
  });

  it("treats a null count as zero", async () => {
    const { client } = makeSupabase({ data: VALID_ROW, error: null }, { count: null, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(result.limits.deckCount).toBe(0);
  });

  it("throws DECK_LIMIT_REACHED when the enforce_deck_limit trigger fires", async () => {
    const { client } = makeSupabase(
      { data: null, error: { message: "Deck limit reached: a user may own at most 120 decks." } },
      { count: 0, error: null },
    );

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_LIMIT_REACHED",
    });
  });

  it("throws DECK_CREATE_FAILED on a generic insert error", async () => {
    const { client } = makeSupabase({ data: null, error: { message: "permission denied" } }, { count: 0, error: null });

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toBeInstanceOf(DeckServiceError);
    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_CREATE_FAILED",
    });
  });

  it("throws DECK_CREATE_FAILED when the count query fails", async () => {
    const { client } = makeSupabase(
      { data: VALID_ROW, error: null },
      { count: null, error: { message: "count failed" } },
    );

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_CREATE_FAILED",
    });
  });
});
