import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateDeckCommand,
  CreateDeckResponseDto,
  DeckDto,
  DeckLimitsDto,
  DeckRow,
  RenameDeckCommand,
  RenameDeckResponseDto,
} from "@/types";

/** Maximum number of decks a single user may own (mirrors the DB trigger). */
export const DECK_LIMIT = 120;

/** Substring used by the `enforce_deck_limit()` trigger exception message. */
const DECK_LIMIT_ERROR_FRAGMENT = "Deck limit reached";

/** Error codes surfaced by the deck service so the route can map them to HTTP. */
export type DeckServiceErrorCode =
  | "DECK_LIMIT_REACHED"
  | "DECK_CREATE_FAILED"
  | "DECK_NOT_FOUND"
  | "DECK_UPDATE_FAILED";

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

/**
 * Computed flashcard counters for a single deck.
 */
interface DeckCounters {
  flashcardsCount: number;
  dueFlashcardsCount: number;
}

/**
 * Fetch the flashcard counters for a single owned deck.
 *
 * Issues two indexed `head`-only count queries (total and due) scoped to the
 * deck and owner. A flashcard is "due" when `due_at <= current_date`.
 *
 * @throws {DeckServiceError} `DECK_UPDATE_FAILED` if either count query fails.
 */
async function getDeckCounters(supabase: SupabaseClient, userId: string, deckId: string): Promise<DeckCounters> {
  const { count: total, error: totalError } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId)
    .eq("user_id", userId);

  if (totalError) {
    throw new DeckServiceError("DECK_UPDATE_FAILED", "Failed to read flashcard count.", {
      cause: totalError,
    });
  }

  // `due_at` is a `date`; compare against today's date (`YYYY-MM-DD`).
  const today = new Date().toISOString().slice(0, 10);
  const { count: due, error: dueError } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId)
    .eq("user_id", userId)
    .lte("due_at", today);

  if (dueError) {
    throw new DeckServiceError("DECK_UPDATE_FAILED", "Failed to read due flashcard count.", {
      cause: dueError,
    });
  }

  return {
    flashcardsCount: total ?? 0,
    dueFlashcardsCount: due ?? 0,
  };
}

/**
 * Rename a deck owned by the given user and return its updated representation
 * with current flashcard counters.
 *
 * The update is scoped by both `id` and `user_id` (defence in depth with RLS),
 * so a user can only rename their own deck. `updated_at` is refreshed by the
 * `set_updated_at()` trigger.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes writes to the user).
 * @param userId   Owner id, always derived from the session — never the request body.
 * @param deckId   UUID of the deck to rename (already validated by the route).
 * @param command  Validated input ({@link RenameDeckCommand}).
 * @throws {DeckServiceError} `DECK_NOT_FOUND` when the deck does not exist or is
 *         owned by another user; `DECK_UPDATE_FAILED` for any other failure.
 */
export async function renameDeck(
  supabase: SupabaseClient,
  userId: string,
  deckId: string,
  command: RenameDeckCommand,
): Promise<RenameDeckResponseDto> {
  // 1. Update only the `name`, scoped to the owning user, returning the row.
  const { data: updated, error: updateError } = await supabase
    .from("decks")
    .update({ name: command.name })
    .eq("id", deckId)
    .eq("user_id", userId)
    .select("id, name, created_at, updated_at")
    .maybeSingle();

  if (updateError) {
    throw new DeckServiceError("DECK_UPDATE_FAILED", "Failed to rename deck.", {
      cause: updateError,
    });
  }

  // 2. No row returned → deck missing or not owned by the requester.
  if (!updated) {
    throw new DeckServiceError("DECK_NOT_FOUND", "Deck not found.");
  }

  const row = updated as DeckRow;

  // 3. Fetch the deck's current counters to build the full DeckDto.
  const counters = await getDeckCounters(supabase, userId, deckId);

  const deck: DeckDto = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    flashcardsCount: counters.flashcardsCount,
    dueFlashcardsCount: counters.dueFlashcardsCount,
  };

  return { deck };
}
