import { z } from "zod";

/**
 * Validation schema for the `GET /api/study/due` query string.
 *
 * Rules (mirror the get-due-study-queue implementation plan):
 * - `deckId`: optional UUID. When present, scopes the due queue to one deck
 *   (ownership is verified later in the service layer).
 * - `limit`: coerced integer, default `20`, min `1`, capped at `100`.
 * - `cursor`: opaque, optional pagination token from a previous response.
 * - `includeFuturePreview`: optional boolean, default `false`. Accepts the
 *   common query encodings `true`/`false`/`1`/`0` (case-insensitive).
 *
 * A plain (non-strict) object is used so unknown query parameters are ignored
 * rather than rejected, matching the existing list-endpoint style.
 */

/**
 * Parse a query-string boolean. `URLSearchParams` always yields strings, so
 * `z.coerce.boolean()` is unusable here (`"false"` would coerce to `true`).
 * Accepts `true`/`1` → `true` and `false`/`0` → `true`/`false`; any other value
 * is passed through untouched so Zod reports an `invalid_type` issue.
 */
function parseQueryBoolean(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return value;
}

/** Validation schema for the `GET /api/study/due` query parameters. */
export const studyDueQuerySchema = z.object({
  deckId: z.uuid("Deck id must be a valid UUID.").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  includeFuturePreview: z.preprocess(parseQueryBoolean, z.boolean()).default(false),
});

/** Parsed and validated query parameters for the due study queue. */
export type StudyDueInput = z.infer<typeof studyDueQuerySchema>;

/**
 * Validation schema for the `POST /api/study/reviews` request body.
 *
 * Rules (mirror the submit-study-review implementation plan):
 * - `flashcardId`: required, must be a valid UUID.
 * - `grade`: required, one of `again`, `hard`, `good`, `easy`.
 *
 * A strict object is used so clients cannot smuggle SM-2 fields (`sm2Interval`,
 * `dueAt`, etc.) into the payload — all scheduling state is computed server-side.
 */
export const submitReviewSchema = z.strictObject({
  flashcardId: z.uuid("Flashcard id must be a valid UUID."),
  grade: z.enum(["again", "hard", "good", "easy"]),
});

/** Parsed and validated body for a submitted study review. */
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
