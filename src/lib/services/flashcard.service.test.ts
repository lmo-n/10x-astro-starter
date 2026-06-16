import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearDeckFlashcards,
  createManualFlashcard,
  deleteFlashcard,
  updateFlashcard,
  toFlashcardDto,
  FlashcardServiceError,
} from "./flashcard.service";
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

interface DeleteResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

/**
 * Build a mock that mimics the single query chain used by `deleteFlashcard`:
 *   `.from("flashcards").delete().eq("id", …).eq("user_id", …).select("id")`
 *
 * The terminal `.select("id")` resolves to the affected-row result.
 */
function makeDeleteSupabase(deleteResult: DeleteResult) {
  const select = vi.fn().mockResolvedValue(deleteResult);
  const eq2 = vi.fn(() => ({ select }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ delete: del }));

  const client = { from } as unknown as SupabaseClient;
  return { client, from, del, eq1, eq2, select };
}

describe("deleteFlashcard", () => {
  it("deletes a flashcard scoped by id and user_id and resolves on success", async () => {
    const { client, from, del, eq1, eq2, select } = makeDeleteSupabase({ data: [{ id: "card-1" }], error: null });

    await expect(deleteFlashcard(client, "user-1", "card-1")).resolves.toBeUndefined();

    // Delete targets the flashcards table and is scoped by both id and user_id.
    expect(from).toHaveBeenCalledWith("flashcards");
    expect(del).toHaveBeenCalledTimes(1);
    expect(eq1).toHaveBeenCalledWith("id", "card-1");
    expect(eq2).toHaveBeenCalledWith("user_id", "user-1");
    // Only the id is selected from the deleted rows; no content is fetched.
    expect(select).toHaveBeenCalledWith("id");
  });

  it("throws FLASHCARD_NOT_FOUND when no row was deleted", async () => {
    const { client } = makeDeleteSupabase({ data: [], error: null });

    await expect(deleteFlashcard(client, "user-1", "card-1")).rejects.toBeInstanceOf(FlashcardServiceError);
    await expect(deleteFlashcard(client, "user-1", "card-1")).rejects.toMatchObject({
      code: "FLASHCARD_NOT_FOUND",
    });
  });

  it("throws FLASHCARD_DELETE_FAILED when the delete errors", async () => {
    const { client } = makeDeleteSupabase({ data: null, error: { message: "permission denied" } });

    await expect(deleteFlashcard(client, "user-1", "card-1")).rejects.toMatchObject({
      code: "FLASHCARD_DELETE_FAILED",
    });
  });

  it("does not look up the parent deck before deleting", async () => {
    const { client, from } = makeDeleteSupabase({ data: [{ id: "card-1" }], error: null });

    await deleteFlashcard(client, "user-1", "card-1");

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith("decks");
  });
});

// ---------------------------------------------------------------------------
// clearDeckFlashcards
// ---------------------------------------------------------------------------

interface ArrayResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/**
 * Build a mock that mimics the two query chains used by `clearDeckFlashcards`:
 *   - deck check: `.from("decks").select().eq().eq().maybeSingle()`
 *   - bulk delete: `.from("flashcards").delete().eq().eq().select()`
 */
function makeClearSupabase(deckResult: SingleResult, deleteResult: ArrayResult = { data: [], error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(deckResult);
  const deckEq2 = vi.fn(() => ({ maybeSingle }));
  const deckEq1 = vi.fn(() => ({ eq: deckEq2 }));
  const deckSelect = vi.fn(() => ({ eq: deckEq1 }));

  const deleteSelect = vi.fn().mockResolvedValue(deleteResult);
  const flashEq2 = vi.fn(() => ({ select: deleteSelect }));
  const flashEq1 = vi.fn(() => ({ eq: flashEq2 }));
  const del = vi.fn(() => ({ eq: flashEq1 }));

  const from = vi.fn((table: string) => {
    if (table === "decks") return { select: deckSelect };
    return { delete: del };
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, from, del, flashEq1, flashEq2, deleteSelect };
}

describe("clearDeckFlashcards", () => {
  it("verifies deck ownership then bulk-deletes flashcards scoped by deck_id and user_id", async () => {
    const { client, from, del, flashEq1, flashEq2, deleteSelect } = makeClearSupabase(
      { data: { id: "deck-1" }, error: null },
      { data: [{ id: "card-1" }, { id: "card-2" }], error: null },
    );

    const result = await clearDeckFlashcards(client, "user-1", "deck-1");

    expect(from).toHaveBeenCalledWith("decks");
    expect(from).toHaveBeenCalledWith("flashcards");
    expect(del).toHaveBeenCalledTimes(1);
    expect(flashEq1).toHaveBeenCalledWith("deck_id", "deck-1");
    expect(flashEq2).toHaveBeenCalledWith("user_id", "user-1");
    expect(deleteSelect).toHaveBeenCalledWith("id");
    expect(result).toEqual({ message: "All flashcards deleted successfully", deletedCount: 2 });
  });

  it("returns deletedCount 0 when the deck is already empty", async () => {
    const { client } = makeClearSupabase({ data: { id: "deck-1" }, error: null }, { data: [], error: null });

    const result = await clearDeckFlashcards(client, "user-1", "deck-1");

    expect(result.deletedCount).toBe(0);
    expect(result.message).toBe("All flashcards deleted successfully");
  });

  it("throws DECK_NOT_FOUND and does not delete when the deck is missing or foreign", async () => {
    const { client, del } = makeClearSupabase({ data: null, error: null });

    await expect(clearDeckFlashcards(client, "user-1", "deck-1")).rejects.toMatchObject({
      code: "DECK_NOT_FOUND",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("throws FLASHCARD_DELETE_FAILED when the deck ownership query errors", async () => {
    const { client, del } = makeClearSupabase({ data: null, error: { message: "permission denied" } });

    await expect(clearDeckFlashcards(client, "user-1", "deck-1")).rejects.toMatchObject({
      code: "FLASHCARD_DELETE_FAILED",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("throws FLASHCARD_DELETE_FAILED when the bulk delete query errors", async () => {
    const { client } = makeClearSupabase(
      { data: { id: "deck-1" }, error: null },
      { data: null, error: { message: "delete failed" } },
    );

    await expect(clearDeckFlashcards(client, "user-1", "deck-1")).rejects.toMatchObject({
      code: "FLASHCARD_DELETE_FAILED",
    });
  });
});

// ---------------------------------------------------------------------------
// updateFlashcard
// ---------------------------------------------------------------------------

const UPDATED_ROW: FlashcardRow = {
  id: "card-1",
  user_id: "user-1",
  deck_id: "deck-1",
  front_text: "Updated front?",
  back_text: "Updated back.",
  created_by_ai: false,
  sm2_interval: 3,
  sm2_repetition: 2,
  sm2_ease_factor: 2.6,
  due_at: "2026-06-20",
  last_reviewed_at: "2026-06-16",
  created_at: "2026-06-10T10:00:00.000Z",
  updated_at: "2026-06-16T12:00:00.000Z",
};

/**
 * Build a mock for the update chain:
 * `.from("flashcards").update(payload).eq(id).eq(userId).select(cols).maybeSingle()`
 */
function makeUpdateSupabase(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const userEq = vi.fn(() => ({ select }));
  const idEq = vi.fn(() => ({ eq: userEq }));
  const update = vi.fn(() => ({ eq: idEq }));
  const from = vi.fn(() => ({ update }));
  const client = { from } as unknown as SupabaseClient;
  return { client, from, update, idEq, userEq, select, maybeSingle };
}

describe("updateFlashcard", () => {
  it("updates flashcard scoped by id and user_id and returns the DTO", async () => {
    const { client, from, update, idEq, userEq } = makeUpdateSupabase({ data: UPDATED_ROW, error: null });

    const result = await updateFlashcard(client, "user-1", "card-1", {
      frontText: "Updated front?",
      backText: "Updated back.",
    });

    expect(from).toHaveBeenCalledWith("flashcards");
    expect(update).toHaveBeenCalledWith({ front_text: "Updated front?", back_text: "Updated back." });
    expect(idEq).toHaveBeenCalledWith("id", "card-1");
    expect(userEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result.flashcard).toMatchObject({
      id: "card-1",
      frontText: "Updated front?",
      backText: "Updated back.",
      sm2: { interval: 3, repetition: 2, easeFactor: 2.6 },
    });
  });

  it("only includes frontText in payload when only frontText is provided", async () => {
    const { client, update } = makeUpdateSupabase({ data: UPDATED_ROW, error: null });

    await updateFlashcard(client, "user-1", "card-1", { frontText: "Updated front?" });

    expect(update).toHaveBeenCalledWith({ front_text: "Updated front?" });
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ back_text: expect.anything() }));
  });

  it("only includes backText in payload when only backText is provided", async () => {
    const { client, update } = makeUpdateSupabase({ data: UPDATED_ROW, error: null });

    await updateFlashcard(client, "user-1", "card-1", { backText: "Updated back." });

    expect(update).toHaveBeenCalledWith({ back_text: "Updated back." });
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ front_text: expect.anything() }));
  });

  it("never includes SM-2, deck_id, created_by_ai, or ownership fields in the payload", async () => {
    const { client, update } = makeUpdateSupabase({ data: UPDATED_ROW, error: null });

    await updateFlashcard(client, "user-1", "card-1", { frontText: "Front?", backText: "Back." });

    const payload = (update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const forbidden = [
      "sm2_interval",
      "sm2_repetition",
      "sm2_ease_factor",
      "due_at",
      "last_reviewed_at",
      "deck_id",
      "created_by_ai",
      "user_id",
      "id",
      "created_at",
      "updated_at",
    ];
    for (const key of forbidden) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("maps returned row to FlashcardDto including unchanged SM-2 state", async () => {
    const { client } = makeUpdateSupabase({ data: UPDATED_ROW, error: null });

    const result = await updateFlashcard(client, "user-1", "card-1", { frontText: "Updated front?" });

    expect(result.flashcard.sm2).toEqual({
      interval: 3,
      repetition: 2,
      easeFactor: 2.6,
      dueAt: "2026-06-20",
      lastReviewedAt: "2026-06-16",
    });
    expect(result.flashcard).not.toHaveProperty("userId");
  });

  it("throws FLASHCARD_NOT_FOUND when no row is returned", async () => {
    const { client } = makeUpdateSupabase({ data: null, error: null });

    await expect(updateFlashcard(client, "user-1", "card-1", { frontText: "Front?" })).rejects.toMatchObject({
      code: "FLASHCARD_NOT_FOUND",
    });
  });

  it("throws FLASHCARD_UPDATE_FAILED on a Supabase error", async () => {
    const { client } = makeUpdateSupabase({ data: null, error: { message: "db error" } });

    await expect(updateFlashcard(client, "user-1", "card-1", { frontText: "Front?" })).rejects.toMatchObject({
      code: "FLASHCARD_UPDATE_FAILED",
    });
  });
});
