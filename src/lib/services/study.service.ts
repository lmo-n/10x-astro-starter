import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FlashcardRow,
  GetStudyDueResponseDto,
  PaginationDto,
  ReviewGrade,
  StudyDueSummaryDto,
  StudyQueueItemDto,
  SubmitReviewCommand,
  SubmitReviewResponseDto,
} from "@/types";
import type { StudyDueInput } from "@/lib/validation/study";
import { toFlashcardDto } from "@/lib/services/flashcard.service";

/** Columns selected from `flashcards` to build a {@link StudyQueueItemDto}. */
const FLASHCARD_COLUMNS =
  "id, user_id, deck_id, front_text, back_text, created_by_ai, sm2_interval, sm2_repetition, sm2_ease_factor, due_at, last_reviewed_at, created_at, updated_at";

/** Product cap for the "suggested today" study recommendation. */
export const SUGGESTED_TODAY_CAP = 25;

/** Error codes surfaced by the study service so the route can map them to HTTP. */
export type StudyServiceErrorCode =
  | "DECK_NOT_FOUND"
  | "STUDY_QUEUE_FAILED"
  | "INVALID_QUERY"
  | "FLASHCARD_NOT_FOUND"
  | "REVIEW_SAVE_FAILED";

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

// ---------------------------------------------------------------------------
// Study reviews (SM-2 scheduling)
// ---------------------------------------------------------------------------

/**
 * Map a client review {@link ReviewGrade} to an SM-2 quality value `q` in the
 * standard `0..5` range. Only the four product grades are exposed:
 *   `again` → 2, `hard` → 3, `good` → 4, `easy` → 5.
 * A quality below `3` is treated as a failed recall (resets the repetition run).
 */
const GRADE_TO_QUALITY: Record<ReviewGrade, number> = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
};

/** Lower bound for the SM-2 ease factor, per the original algorithm. */
const MIN_EASE_FACTOR = 1.3;

/** Mutable SM-2 scheduling state used as input to {@link calculateSm2Schedule}. */
export interface Sm2State {
  interval: number;
  repetition: number;
  easeFactor: number;
}

/** Result of an SM-2 calculation: the next scheduling state plus dates. */
export interface Sm2Schedule extends Sm2State {
  /** `YYYY-MM-DD` — `today + interval` days. */
  dueAt: string;
  /** `YYYY-MM-DD` — the review date (`today`). */
  lastReviewedAt: string;
}

/** Round a numeric ease factor to two decimals to match `numeric(4,2)` storage. */
function roundEaseFactor(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Add `days` to a `YYYY-MM-DD` date string and return the result as `YYYY-MM-DD`.
 * Uses UTC arithmetic so it is unaffected by the server's local timezone.
 */
function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Compute the next SM-2 scheduling state for a reviewed flashcard.
 *
 * Implements the classic SM-2 algorithm:
 *  - The grade is mapped to a quality value `q` (see {@link GRADE_TO_QUALITY}).
 *  - The ease factor is always updated with
 *    `EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))` and clamped to a
 *    minimum of {@link MIN_EASE_FACTOR}.
 *  - On a failed recall (`q < 3`) the repetition run resets to `0` and the card
 *    is rescheduled for the next day (`interval = 1`).
 *  - On a successful recall (`q >= 3`) the repetition increments and the interval
 *    grows: `1` day for the first success, `6` days for the second, then
 *    `round(previousInterval * EF')` afterwards.
 *
 * All scheduling is computed server-side; the client only supplies the grade.
 *
 * @param current SM-2 state of the card before this review.
 * @param grade   The client-submitted review grade.
 * @param today   Review date as `YYYY-MM-DD`; `dueAt` is `today + interval` days.
 */
export function calculateSm2Schedule(current: Sm2State, grade: ReviewGrade, today: string): Sm2Schedule {
  const quality = GRADE_TO_QUALITY[grade];

  // Ease factor is recomputed on every review and clamped to the SM-2 minimum.
  const easeFactor = roundEaseFactor(
    Math.max(MIN_EASE_FACTOR, current.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))),
  );

  let repetition: number;
  let interval: number;

  if (quality < 3) {
    // Failed recall: reset the repetition run and review again tomorrow.
    repetition = 0;
    interval = 1;
  } else {
    repetition = current.repetition + 1;
    if (repetition === 1) {
      interval = 1;
    } else if (repetition === 2) {
      interval = 6;
    } else {
      interval = Math.round(current.interval * easeFactor);
    }
  }

  // Guard against a degenerate zero/negative interval from rounding.
  interval = Math.max(1, interval);

  return {
    interval,
    repetition,
    easeFactor,
    dueAt: addDays(today, interval),
    lastReviewedAt: today,
  };
}

/**
 * Record a study review for one of the authenticated user's flashcards and
 * update its SM-2 scheduling state.
 *
 * The client only supplies `flashcardId` and `grade`; every scheduling change
 * (`sm2_interval`, `sm2_repetition`, `sm2_ease_factor`, `due_at`,
 * `last_reviewed_at`) is computed server-side. Card text, deck membership,
 * ownership and AI-origin metadata are never modified.
 *
 * Steps:
 *  1. Fetch the owned card by `id` + `user_id` → `FLASHCARD_NOT_FOUND` (404) when
 *     missing or foreign (prevents resource enumeration).
 *  2. Compute the next SM-2 state from the card's current state and the grade.
 *  3. Update only the scheduling columns, returning the updated row.
 *  4. Count remaining due cards for the user (`head: true`).
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes access to the user).
 * @param userId   Owner id, always derived from the session — never the request body.
 * @param command  Validated input ({@link SubmitReviewCommand}).
 * @throws {StudyServiceError} `FLASHCARD_NOT_FOUND` for a missing/foreign card;
 *         `REVIEW_SAVE_FAILED` on any query/update failure.
 */
export async function submitStudyReview(
  supabase: SupabaseClient,
  userId: string,
  command: SubmitReviewCommand,
): Promise<SubmitReviewResponseDto> {
  const { flashcardId, grade } = command;
  const today = todayDate();

  // 1. Fetch the owned flashcard (scoped by id + user_id; RLS also enforces this).
  const { data: existing, error: fetchError } = await supabase
    .from("flashcards")
    .select(FLASHCARD_COLUMNS)
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) {
    throw new StudyServiceError("REVIEW_SAVE_FAILED", "Failed to load the flashcard.", { cause: fetchError });
  }

  if (!existing) {
    throw new StudyServiceError("FLASHCARD_NOT_FOUND", "Flashcard not found.");
  }

  // Map to the typed DTO first so the SM-2 state is read with concrete types
  // (the untyped Supabase client returns `data` as `any`).
  const currentSm2 = toFlashcardDto(existing).sm2;

  // 2. Compute the next SM-2 scheduling state server-side.
  const schedule = calculateSm2Schedule(
    {
      interval: currentSm2.interval,
      repetition: currentSm2.repetition,
      easeFactor: currentSm2.easeFactor,
    },
    grade,
    today,
  );

  // 3. Update ONLY the scheduling columns; `updated_at` is managed by a DB trigger.
  const { data: updated, error: updateError } = await supabase
    .from("flashcards")
    .update({
      sm2_interval: schedule.interval,
      sm2_repetition: schedule.repetition,
      sm2_ease_factor: schedule.easeFactor,
      due_at: schedule.dueAt,
      last_reviewed_at: schedule.lastReviewedAt,
    })
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .select(FLASHCARD_COLUMNS)
    .maybeSingle();

  if (updateError) {
    throw new StudyServiceError("REVIEW_SAVE_FAILED", "Failed to save the review.", { cause: updateError });
  }

  if (!updated) {
    // The row vanished between the fetch and the update (e.g. concurrent delete).
    throw new StudyServiceError("FLASHCARD_NOT_FOUND", "Flashcard not found.");
  }

  // 4. Count remaining due cards for the user after this review (`head: true`).
  const { count, error: countError } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("due_at", today);

  if (countError) {
    throw new StudyServiceError("REVIEW_SAVE_FAILED", "Failed to count remaining due flashcards.", {
      cause: countError,
    });
  }

  return {
    flashcard: toFlashcardDto(updated),
    nextDueCount: count ?? 0,
  };
}
