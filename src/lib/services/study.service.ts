import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FlashcardRow,
  GetStudyDueResponseDto,
  PaginationDto,
  StudyDueSummaryDto,
  StudyQueueItemDto,
} from "@/types";
import type { StudyDueInput } from "@/lib/validation/study";
import { toFlashcardDto } from "@/lib/services/flashcard.service";

/** Columns selected from `flashcards` to build a {@link StudyQueueItemDto}. */
const FLASHCARD_COLUMNS =
  "id, user_id, deck_id, front_text, back_text, created_by_ai, sm2_interval, sm2_repetition, sm2_ease_factor, due_at, last_reviewed_at, created_at, updated_at";

/** Product cap for the "suggested today" study recommendation. */
export const SUGGESTED_TODAY_CAP = 25;

/** Error codes surfaced by the study service so the route can map them to HTTP. */
export type StudyServiceErrorCode = "DECK_NOT_FOUND" | "STUDY_QUEUE_FAILED" | "INVALID_QUERY";

/**
 * Domain error thrown by the study service. The `code` is mapped to an HTTP
 * status / `ApiErrorDto.error.code` by the route handler.
 */
export class StudyServiceError extends Error {
  readonly code: StudyServiceErrorCode;

  constructor(code: StudyServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudyServiceError";
    this.code = code;
  }
}

/**
 * Map a `flashcards` row to a {@link StudyQueueItemDto}. Reuses
 * {@link toFlashcardDto} and strips the fields the study queue does not expose
 * (`createdByAi`, `createdAt`, `updatedAt`).
 */
export function toStudyQueueItemDto(row: FlashcardRow): StudyQueueItemDto {
  const { createdByAi: _createdByAi, createdAt: _createdAt, updatedAt: _updatedAt, ...item } = toFlashcardDto(row);
  return item;
}

/**
 * Keyset anchor embedded in an opaque cursor. `dueAt` is the due date of the
 * last row on the previous page; `id` is the stable tiebreaker for cards
 * sharing the same `due_at`.
 */
interface StudyCursorAnchor {
  dueAt: string;
  id: string;
}

/** Encode a keyset anchor as an opaque base64 cursor. */
function encodeCursor(anchor: StudyCursorAnchor): string {
  return Buffer.from(JSON.stringify(anchor), "utf8").toString("base64");
}

/**
 * Decode and validate an opaque cursor for the due queue.
 *
 * @throws {StudyServiceError} `INVALID_QUERY` when the cursor is malformed.
 */
function decodeCursor(raw: string): StudyCursorAnchor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new StudyServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as StudyCursorAnchor).dueAt !== "string" ||
    typeof (parsed as StudyCursorAnchor).id !== "string"
  ) {
    throw new StudyServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  return parsed as StudyCursorAnchor;
}

/**
 * Verify that `deckId` exists and is owned by `userId`.
 *
 * @throws {StudyServiceError} `DECK_NOT_FOUND` for a missing or foreign deck;
 *         `STUDY_QUEUE_FAILED` on a query failure.
 */
async function assertDeckOwnership(supabase: SupabaseClient, userId: string, deckId: string): Promise<void> {
  const { data, error } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new StudyServiceError("STUDY_QUEUE_FAILED", "Failed to verify deck ownership.", { cause: error });
  }

  if (!data) {
    throw new StudyServiceError("DECK_NOT_FOUND", "Deck not found.");
  }
}

/** Today's date as `YYYY-MM-DD` (matches the `date` column comparison convention). */
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the authenticated user's due-card study queue, optionally scoped to one
 * owned deck, with cursor pagination and a summary block for the Study Mode UI.
 *
 * A flashcard is "due" when `due_at <= today`. `data` only ever contains due
 * cards; future cards are never returned, but they can be counted in
 * `summary.upcomingCount` when `includeFuturePreview` is enabled.
 *
 * Paging uses keyset pagination on `(due_at, id)` ordered ascending, fetching
 * `limit + 1` rows to compute `hasMore` without a second query.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes reads to the user).
 * @param userId   Owner id, always derived from the session — never the request.
 * @param query    Validated query parameters ({@link StudyDueInput}).
 * @throws {StudyServiceError} `DECK_NOT_FOUND` for a foreign/missing deck filter,
 *         `INVALID_QUERY` for a malformed cursor, `STUDY_QUEUE_FAILED` otherwise.
 */
export async function getDueStudyQueue(
  supabase: SupabaseClient,
  userId: string,
  query: StudyDueInput,
): Promise<GetStudyDueResponseDto> {
  const { deckId, limit, cursor, includeFuturePreview } = query;
  const today = todayDate();

  // 1. Verify optional deck ownership before using it as a filter.
  if (deckId) {
    await assertDeckOwnership(supabase, userId, deckId);
  }

  // 2. Build the due-card page query, scoped to the owner (RLS also enforces this).
  let builder = supabase.from("flashcards").select(FLASHCARD_COLUMNS).eq("user_id", userId).lte("due_at", today);

  if (deckId) {
    builder = builder.eq("deck_id", deckId);
  }

  // 3. Keyset predicate from the cursor (if any). Advance past the anchor on
  //    `due_at`, using `id` as the deterministic tiebreaker for same-day cards.
  if (cursor) {
    const anchor = decodeCursor(cursor);
    builder = builder.or(`due_at.gt.${anchor.dueAt},and(due_at.eq.${anchor.dueAt},id.gt.${anchor.id})`);
  }

  // 4. Stable ordering: `due_at ASC, id ASC`. Fetch one extra row to detect a
  //    following page.
  const { data, error } = await builder
    .order("due_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (error) {
    throw new StudyServiceError("STUDY_QUEUE_FAILED", "Failed to load the due study queue.", { cause: error });
  }

  const rows = (data ?? []) as FlashcardRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // 5. Build the next cursor from the last row of the page.
  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({ dueAt: last.due_at, id: last.id });
  }

  const pagination: PaginationDto = { nextCursor, hasMore };

  // 6. Total due-card count for the summary (`head: true` transfers only the count).
  let dueCountBuilder = supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("due_at", today);
  if (deckId) {
    dueCountBuilder = dueCountBuilder.eq("deck_id", deckId);
  }

  const { count: dueCountRaw, error: dueCountError } = await dueCountBuilder;
  if (dueCountError) {
    throw new StudyServiceError("STUDY_QUEUE_FAILED", "Failed to count due flashcards.", { cause: dueCountError });
  }
  const dueCount = dueCountRaw ?? 0;

  // 7. Optional future-card count (content is never returned, only counted).
  let upcomingCount = 0;
  if (includeFuturePreview) {
    let upcomingBuilder = supabase
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("due_at", today);
    if (deckId) {
      upcomingBuilder = upcomingBuilder.eq("deck_id", deckId);
    }

    const { count: upcomingRaw, error: upcomingError } = await upcomingBuilder;
    if (upcomingError) {
      throw new StudyServiceError("STUDY_QUEUE_FAILED", "Failed to count upcoming flashcards.", {
        cause: upcomingError,
      });
    }
    upcomingCount = upcomingRaw ?? 0;
  }

  const summary: StudyDueSummaryDto = {
    dueCount,
    suggestedTodayCount: Math.min(dueCount, SUGGESTED_TODAY_CAP),
    upcomingCount,
  };

  return {
    data: pageRows.map(toStudyQueueItemDto),
    pagination,
    summary,
  };
}
