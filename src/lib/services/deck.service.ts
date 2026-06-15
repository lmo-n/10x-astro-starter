import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateDeckCommand,
  CreateDeckResponseDto,
  DeckDto,
  DeckLimitsDto,
  DeckRow,
  ListDecksResponseDto,
  PaginationDto,
  RenameDeckCommand,
  RenameDeckResponseDto,
  SortOrder,
} from "@/types";
import type { ListDecksInput } from "@/lib/validation/decks";

/** Maximum number of decks a single user may own (mirrors the DB trigger). */
export const DECK_LIMIT = 120;

/** Substring used by the `enforce_deck_limit()` trigger exception message. */
const DECK_LIMIT_ERROR_FRAGMENT = "Deck limit reached";

/** Error codes surfaced by the deck service so the route can map them to HTTP. */
export type DeckServiceErrorCode =
  | "DECK_LIMIT_REACHED"
  | "DECK_CREATE_FAILED"
  | "DECK_NOT_FOUND"
  | "DECK_UPDATE_FAILED"
  | "DECK_DELETE_FAILED"
  | "DECK_LIST_FAILED"
  | "INVALID_QUERY";

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

/**
 * Permanently delete a deck owned by the given user. Deleting a deck cascades
 * to all of its flashcards via the `flashcards.deck_id` `ON DELETE CASCADE`
 * foreign key, so no separate flashcard delete is required.
 *
 * The delete is scoped by both `id` and `user_id` (defence in depth with RLS),
 * so a user can only delete their own deck. A non-existent deck or one owned by
 * another user is indistinguishable and surfaces as `DECK_NOT_FOUND` (404) to
 * prevent resource enumeration.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes writes to the user).
 * @param userId   Owner id, always derived from the session — never the request body.
 * @param deckId   UUID of the deck to delete (already validated by the route).
 * @throws {DeckServiceError} `DECK_NOT_FOUND` when no owned deck matches;
 *         `DECK_DELETE_FAILED` for any other persistence failure.
 */
export async function deleteDeck(supabase: SupabaseClient, userId: string, deckId: string): Promise<void> {
  // Single delete scoped to the owning user, returning affected ids so we can
  // distinguish "deleted" from "nothing matched" without an extra round-trip.
  const { data: deleted, error: deleteError } = await supabase
    .from("decks")
    .delete()
    .eq("id", deckId)
    .eq("user_id", userId)
    .select("id");

  if (deleteError) {
    throw new DeckServiceError("DECK_DELETE_FAILED", "Failed to delete deck.", {
      cause: deleteError,
    });
  }

  // No row deleted → deck missing or not owned by the requester.
  if (deleted.length === 0) {
    throw new DeckServiceError("DECK_NOT_FOUND", "Deck not found.");
  }
}

// -----------------------------------------------------------------------------
// List decks (GET /api/decks)
// -----------------------------------------------------------------------------

/** Map the API `sort` value to the underlying snake_case `decks` column. */
const SORT_COLUMN: Record<ListDecksInput["sort"], keyof DeckRow> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  name: "name",
};

/**
 * Keyset anchor embedded in an opaque cursor. `value` is the sort column's
 * value of the last row on the previous page; `id` is the stable tiebreaker.
 * `sort`/`order` bind the cursor to the query shape that produced it.
 */
interface CursorAnchor {
  sort: ListDecksInput["sort"];
  order: SortOrder;
  value: string;
  id: string;
}

/** Encode a keyset anchor as an opaque base64 cursor. */
function encodeCursor(anchor: CursorAnchor): string {
  return Buffer.from(JSON.stringify(anchor), "utf8").toString("base64");
}

/**
 * Decode and validate an opaque cursor against the current query shape.
 *
 * @throws {DeckServiceError} `INVALID_QUERY` when the cursor is malformed or was
 *         issued for a different `sort`/`order` combination (prevents
 *         inconsistent paging and tampering).
 */
function decodeCursor(raw: string, sort: ListDecksInput["sort"], order: SortOrder): CursorAnchor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new DeckServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CursorAnchor).value !== "string" ||
    typeof (parsed as CursorAnchor).id !== "string" ||
    (parsed as CursorAnchor).sort !== sort ||
    (parsed as CursorAnchor).order !== order
  ) {
    throw new DeckServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  return parsed as CursorAnchor;
}

/** Deck row shape selected for the list query (includes the sort columns). */
type DeckListRow = Pick<DeckRow, "id" | "name" | "created_at" | "updated_at">;

/**
 * List the authenticated user's decks with cursor-based pagination, sorting,
 * and optional case-insensitive name search. Each returned deck is enriched
 * with `flashcardsCount` and `dueFlashcardsCount`, and the response carries the
 * user's current deck `limits`.
 *
 * Paging uses keyset (cursor) pagination on `(sortColumn, id)` to keep latency
 * constant as the table grows, fetching `limit + 1` rows to compute `hasMore`.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes reads to the user).
 * @param userId   Owner id, always derived from the session — never the request.
 * @param query    Validated query parameters ({@link ListDecksInput}).
 * @throws {DeckServiceError} `INVALID_QUERY` for a malformed/mismatched cursor;
 *         `DECK_LIST_FAILED` for any query/count failure.
 */
export async function listDecks(
  supabase: SupabaseClient,
  userId: string,
  query: ListDecksInput,
): Promise<ListDecksResponseDto> {
  const { limit, cursor, sort, order, search } = query;
  const column = SORT_COLUMN[sort];
  const ascending = order === "asc";

  // 1. Build the base query, scoped to the owner (RLS also enforces this).
  let builder = supabase.from("decks").select("id, name, created_at, updated_at").eq("user_id", userId);

  // 2. Optional case-insensitive name filter.
  if (search) {
    builder = builder.ilike("name", `%${search}%`);
  }

  // 3. Keyset predicate from the cursor (if any). For each ordering direction we
  //    advance past the anchor on the sort column, using `id` as a deterministic
  //    tiebreaker for rows sharing the same sort value.
  if (cursor) {
    const anchor = decodeCursor(cursor, sort, order);
    const op = ascending ? "gt" : "lt";
    const tiebreak = ascending ? "gt" : "lt";
    // (column <op> value) OR (column = value AND id <tiebreak> anchorId)
    builder = builder.or(
      `${column}.${op}.${anchor.value},and(${column}.eq.${anchor.value},id.${tiebreak}.${anchor.id})`,
    );
  }

  // 4. Stable ordering: sort column first, then `id` tiebreaker. Fetch one extra
  //    row to determine whether another page exists.
  const { data, error } = await builder
    .order(column, { ascending })
    .order("id", { ascending })
    .limit(limit + 1);

  if (error) {
    throw new DeckServiceError("DECK_LIST_FAILED", "Failed to list decks.", { cause: error });
  }

  const rows = data as DeckListRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  // 5. Compute per-deck counters for the page in a single aggregate pass
  //    (avoids an N+1 query per deck).
  const deckIds = pageRows.map((r) => r.id);
  const counters = await getDeckCountersBatch(supabase, userId, deckIds);

  const decks: DeckDto[] = pageRows.map((row) => {
    const c = counters.get(row.id) ?? { flashcardsCount: 0, dueFlashcardsCount: 0 };
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      flashcardsCount: c.flashcardsCount,
      dueFlashcardsCount: c.dueFlashcardsCount,
    };
  });

  // 6. Build the next cursor from the last row of the page.
  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({
      sort,
      order,
      value: last[column as keyof DeckListRow],
      id: last.id,
    });
  }

  const pagination: PaginationDto = { nextCursor, hasMore };

  // 7. Total deck count for the limits payload (`head: true` transfers only the count).
  const { count, error: countError } = await supabase
    .from("decks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    throw new DeckServiceError("DECK_LIST_FAILED", "Failed to read deck count.", { cause: countError });
  }

  const deckCount = count ?? 0;
  const limits: DeckLimitsDto = {
    deckCount,
    deckLimit: DECK_LIMIT,
    canCreateDeck: deckCount < DECK_LIMIT,
  };

  return { data: decks, pagination, limits };
}

/**
 * Compute `flashcardsCount` and `dueFlashcardsCount` for a set of decks in a
 * single fetch, keyed by `deck_id`. Returns an empty map when no deck ids are
 * supplied. A flashcard is "due" when `due_at <= current_date`.
 *
 * @throws {DeckServiceError} `DECK_LIST_FAILED` if the aggregate query fails.
 */
async function getDeckCountersBatch(
  supabase: SupabaseClient,
  userId: string,
  deckIds: string[],
): Promise<Map<string, DeckCounters>> {
  const result = new Map<string, DeckCounters>();
  if (deckIds.length === 0) {
    return result;
  }

  // Fetch the (deck_id, due_at) pairs for the page's decks and aggregate in
  // memory. This is a single round-trip rather than two counts per deck.
  const { data, error } = await supabase
    .from("flashcards")
    .select("deck_id, due_at")
    .eq("user_id", userId)
    .in("deck_id", deckIds);

  if (error) {
    throw new DeckServiceError("DECK_LIST_FAILED", "Failed to aggregate flashcard counters.", { cause: error });
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const deckId of deckIds) {
    result.set(deckId, { flashcardsCount: 0, dueFlashcardsCount: 0 });
  }

  for (const row of data as { deck_id: string; due_at: string }[]) {
    const entry = result.get(row.deck_id);
    if (!entry) {
      continue;
    }
    entry.flashcardsCount += 1;
    if (row.due_at <= today) {
      entry.dueFlashcardsCount += 1;
    }
  }

  return result;
}
