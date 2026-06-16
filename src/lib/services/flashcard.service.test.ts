import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createManualFlashcard, toFlashcardDto, FlashcardServiceError } from "./flashcard.service";
import type { FlashcardRow } from "@/types";

interface PostgrestLikeError {
  message: string;
}

interface SingleResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

/**
 * Build a mock that mimics the two query chains used by `createManualFlashcard`:
 *   - deck check: `.from("decks").select().eq().eq().maybeSingle()`
 *   - insert:     `.from("flashcards").insert().select().single()`
 *
 * The chain is selected by the table name passed to `.from()`.
 */
function makeSupabase(deckResult: SingleResult, insertResult: SingleResult = { data: null, error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(deckResult);
  const deckEq2 = vi.fn(() => ({ maybeSingle }));
  const deckEq1 = vi.fn(() => ({ eq: deckEq2 }));
  const deckSelect = vi.fn(() => ({ eq: deckEq1 }));

  const single = vi.fn().mockResolvedValue(insertResult);
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const from = vi.fn((table: string) => {
    if (table === "decks") {
      return { select: deckSelect };
    }
    return { insert };
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, from, insert, deckEq1, deckEq2 };
}

const INSERTED_ROW: FlashcardRow = {
  id: "card-1",
  user_id: "user-1",
  deck_id: "deck-1",
  front_text: "What is photosynthesis?",
  back_text: "Plants converting light into chemical energy.",
  created_by_ai: false,
  sm2_interval: 0,
  sm2_repetition: 0,
  sm2_ease_factor: 2.5,
  due_at: "2026-06-16",
  last_reviewed_at: null,
  created_at: "2026-06-16T10:00:00.000Z",
  updated_at: "2026-06-16T10:00:00.000Z",
};

const COMMAND = {
  frontText: "What is photosynthesis?",
  backText: "Plants converting light into chemical energy.",
};

describe("toFlashcardDto", () => {
  it("maps snake_case row columns to the camelCase DTO with nested sm2", () => {
    const dto = toFlashcardDto(INSERTED_ROW);

    expect(dto).toEqual({
      id: "card-1",
      deckId: "deck-1",
      frontText: "What is photosynthesis?",
      backText: "Plants converting light into chemical energy.",
      createdByAi: false,
      sm2: {
        interval: 0,
        repetition: 0,
        easeFactor: 2.5,
        dueAt: "2026-06-16",
        lastReviewedAt: null,
      },
      createdAt: "2026-06-16T10:00:00.000Z",
      updatedAt: "2026-06-16T10:00:00.000Z",
    });
    // `user_id` must not leak into the public DTO.
    expect(dto).not.toHaveProperty("userId");
  });
});

describe("createManualFlashcard", () => {
  it("verifies deck ownership, inserts allowed columns, and returns the DTO", async () => {
    const { client, insert, from } = makeSupabase(
      { data: { id: "deck-1" }, error: null },
      { data: INSERTED_ROW, error: null },
    );

    const result = await createManualFlashcard(client, "user-1", "deck-1", COMMAND);

    // Deck ownership check happens against the `decks` table.
    expect(from).toHaveBeenCalledWith("decks");
    // Insert writes only the allowed columns and forces created_by_ai = false.
    expect(insert).toHaveBeenCalledWith({
      deck_id: "deck-1",
      user_id: "user-1",
      front_text: "What is photosynthesis?",
      back_text: "Plants converting light into chemical energy.",
      created_by_ai: false,
    });
    // DB-assigned defaults are preserved in the returned DTO.
    expect(result.flashcard.sm2).toEqual({
      interval: 0,
      repetition: 0,
      easeFactor: 2.5,
      dueAt: "2026-06-16",
      lastReviewedAt: null,
    });
    expect(result.flashcard.createdByAi).toBe(false);
  });

  it("throws DECK_NOT_FOUND and does not insert when the deck is missing or foreign", async () => {
    const { client, insert } = makeSupabase({ data: null, error: null });

    await expect(createManualFlashcard(client, "user-1", "deck-1", COMMAND)).rejects.toMatchObject({
      code: "DECK_NOT_FOUND",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws FLASHCARD_CREATE_FAILED when the deck lookup errors", async () => {
    const { client, insert } = makeSupabase({ data: null, error: { message: "permission denied" } });

    await expect(createManualFlashcard(client, "user-1", "deck-1", COMMAND)).rejects.toMatchObject({
      code: "FLASHCARD_CREATE_FAILED",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws FLASHCARD_CREATE_FAILED when the insert errors", async () => {
    const { client } = makeSupabase(
      { data: { id: "deck-1" }, error: null },
      { data: null, error: { message: "insert failed" } },
    );

    await expect(createManualFlashcard(client, "user-1", "deck-1", COMMAND)).rejects.toBeInstanceOf(
      FlashcardServiceError,
    );
    await expect(createManualFlashcard(client, "user-1", "deck-1", COMMAND)).rejects.toMatchObject({
      code: "FLASHCARD_CREATE_FAILED",
    });
  });
});
