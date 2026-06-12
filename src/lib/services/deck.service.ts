import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateDeckCommand, CreateDeckResponseDto, DeckDto, DeckLimitsDto, DeckRow } from "@/types";

/** Maximum number of decks a single user may own (mirrors the DB trigger). */
export const DECK_LIMIT = 120;

/** Substring used by the `enforce_deck_limit()` trigger exception message. */
const DECK_LIMIT_ERROR_FRAGMENT = "Deck limit reached";

/** Error codes surfaced by the deck service so the route can map them to HTTP. */
export type DeckServiceErrorCode = "DECK_LIMIT_REACHED" | "DECK_CREATE_FAILED";

/**
 * Domain error thrown by the deck service. The `code` is mapped to an HTTP
 * status / `ApiErrorDto.error.code` by the route handler.
 */
export class DeckServiceError extends Error {
  readonly code: DeckServiceErrorCode;

  constructor(code: DeckServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeckServiceError";
    this.code = code;
  }
}

/** Map a freshly inserted `decks` row to the public `DeckDto`. A new deck has no flashcards. */
function toDeckDto(row: DeckRow): DeckDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    flashcardsCount: 0,
    dueFlashcardsCount: 0,
  };
}

/**
 * Create a new deck for the given user and return its representation together
 * with the current deck limits.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes writes to the user).
 * @param userId   Owner id, always derived from the session — never the request body.
 * @param command  Validated input ({@link CreateDeckCommand}).
 * @throws {DeckServiceError} `DECK_LIMIT_REACHED` when the 120-deck cap is hit,
 *         `DECK_CREATE_FAILED` for any other insert/count failure.
 */
export async function createDeck(
  supabase: SupabaseClient,
  userId: string,
  command: CreateDeckCommand,
): Promise<CreateDeckResponseDto> {
  // 1. Insert the deck and return the created row in a single round-trip.
  const { data: inserted, error: insertError } = await supabase
    .from("decks")
    .insert({ user_id: userId, name: command.name })
    .select("id, name, created_at, updated_at")
    .single();

  if (insertError) {
    // The `enforce_deck_limit()` trigger raises a textual exception; detect it
    // and surface a dedicated 409 rather than a generic 500.
    if (insertError.message.includes(DECK_LIMIT_ERROR_FRAGMENT)) {
      throw new DeckServiceError("DECK_LIMIT_REACHED", "Deck limit reached: a user may own at most 120 decks.", {
        cause: insertError,
      });
    }
    throw new DeckServiceError("DECK_CREATE_FAILED", "Failed to create deck.", {
      cause: insertError,
    });
  }

  const deck = toDeckDto(inserted as DeckRow);

  // 2. Fetch the current deck count to build the limits payload. `head: true`
  //    transfers only the count, not the rows.
  const { count, error: countError } = await supabase
    .from("decks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    throw new DeckServiceError("DECK_CREATE_FAILED", "Failed to read deck count.", {
      cause: countError,
    });
  }

  const deckCount = count ?? 0;
  const limits: DeckLimitsDto = {
    deckCount,
    deckLimit: DECK_LIMIT,
    canCreateDeck: deckCount < DECK_LIMIT,
  };

  return { deck, limits };
}
