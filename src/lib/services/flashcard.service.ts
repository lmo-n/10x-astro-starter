import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateFlashcardCommand, CreateFlashcardResponseDto, FlashcardDto, FlashcardRow } from "@/types";

/** Columns selected from `flashcards` to build a {@link FlashcardDto}. */
const FLASHCARD_COLUMNS =
  "id, user_id, deck_id, front_text, back_text, created_by_ai, sm2_interval, sm2_repetition, sm2_ease_factor, due_at, last_reviewed_at, created_at, updated_at";

/** Error codes surfaced by the flashcard service so the route can map them to HTTP. */
export type FlashcardServiceErrorCode =
  | "DECK_NOT_FOUND"
  | "FLASHCARD_CREATE_FAILED"
  | "FLASHCARD_NOT_FOUND"
  | "FLASHCARD_DELETE_FAILED";

/**
 * Domain error thrown by the flashcard service. The `code` is mapped to an HTTP
 * status / `ApiErrorDto.error.code` by the route handler.
 */
export class FlashcardServiceError extends Error {
  readonly code: FlashcardServiceErrorCode;

  constructor(code: FlashcardServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FlashcardServiceError";
    this.code = code;
  }
}

/**
 * Map a `flashcards` row to the public {@link FlashcardDto}: `user_id` is
 * dropped, the flat `sm2_*` columns are grouped into the nested `sm2` block, and
 * remaining columns are remapped to camelCase. DB-assigned defaults (SM-2 state,
 * timestamps) are passed through rather than recomputed in application code.
 */
export function toFlashcardDto(row: FlashcardRow): FlashcardDto {
  return {
    id: row.id,
    deckId: row.deck_id,
    frontText: row.front_text,
    backText: row.back_text,
    createdByAi: row.created_by_ai,
    sm2: {
      interval: row.sm2_interval,
      repetition: row.sm2_repetition,
      easeFactor: row.sm2_ease_factor,
      dueAt: row.due_at,
      lastReviewedAt: row.last_reviewed_at,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a single manual flashcard inside a deck owned by the given user.
 *
 * The deck ownership is verified before inserting so a missing or foreign deck
 * surfaces as `DECK_NOT_FOUND` (404) instead of leaking a foreign-key/RLS error.
 * Only the allowed columns are written; `created_by_ai` is forced to `false` and
 * all SM-2 / timestamp fields come from database defaults and triggers.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes writes to the user).
 * @param userId   Owner id, always derived from the session — never the request body.
 * @param deckId   UUID of the target deck (already validated by the route).
 * @param command  Validated input ({@link CreateFlashcardCommand}).
 * @throws {FlashcardServiceError} `DECK_NOT_FOUND` when the deck is absent or
 *         owned by another user; `FLASHCARD_CREATE_FAILED` for any other failure.
 */
export async function createManualFlashcard(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  command: CreateFlashcardCommand,
): Promise<CreateFlashcardResponseDto> {
  // 1. Verify the deck exists and is owned by the user (scoped by id + user_id).
  //    Produces the required 404 before attempting an insert.
  const { data: deck, error: deckError } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("user_id", userId)
    .maybeSingle();

  if (deckError) {
    throw new FlashcardServiceError("FLASHCARD_CREATE_FAILED", "Failed to verify deck ownership.", {
      cause: deckError,
    });
  }

  if (!deck) {
    throw new FlashcardServiceError("DECK_NOT_FOUND", "Deck not found.");
  }

  // 2. Insert only allowed columns; rely on DB defaults/triggers for the rest.
  const { data: inserted, error: insertError } = await supabase
    .from("flashcards")
    .insert({
      deck_id: deckId,
      user_id: userId,
      front_text: command.frontText,
      back_text: command.backText,
      created_by_ai: false,
    })
    .select(FLASHCARD_COLUMNS)
    .single();

  if (insertError) {
    throw new FlashcardServiceError("FLASHCARD_CREATE_FAILED", "Failed to create flashcard.", {
      cause: insertError,
    });
  }

  return { flashcard: toFlashcardDto(inserted) };
}

/**
 * Permanently delete a single flashcard owned by the given user.
 *
 * The delete is scoped by both `id` and `user_id` (defence in depth with RLS),
 * so a user can only delete their own flashcard. A non-existent flashcard or one
 * owned by another user is indistinguishable and surfaces as
 * `FLASHCARD_NOT_FOUND` (404) to prevent resource enumeration. Only the `id` of
 * the deleted row is selected so the affected-row check needs no extra read and
 * no flashcard content is fetched or logged.
 *
 * @param supabase    Authenticated Supabase SSR client (RLS scopes writes to the user).
 * @param userId      Owner id, always derived from the session — never the request body.
 * @param flashcardId UUID of the flashcard to delete (already validated by the route).
 * @throws {FlashcardServiceError} `FLASHCARD_NOT_FOUND` when no owned flashcard
 *         matches; `FLASHCARD_DELETE_FAILED` for any other persistence failure.
 */
export async function deleteFlashcard(supabase: SupabaseClient, userId: string, flashcardId: string): Promise<void> {
  // Single delete scoped to the owning user, returning affected ids so we can
  // distinguish "deleted" from "nothing matched" without an extra round-trip.
  const { data: deleted, error: deleteError } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .select("id");

  if (deleteError) {
    throw new FlashcardServiceError("FLASHCARD_DELETE_FAILED", "Failed to delete flashcard.", {
      cause: deleteError,
    });
  }

  // No row deleted → flashcard missing or not owned by the requester.
  if (deleted.length === 0) {
    throw new FlashcardServiceError("FLASHCARD_NOT_FOUND", "Flashcard not found.");
  }
}
