import { z } from "zod";

/**
 * Validation schemas for the manual flashcard endpoints.
 *
 * Mirrors the create-flashcard implementation plan:
 * - `frontText`: trimmed, non-empty, max 500 chars, plain text only, and must
 *   satisfy the short-question heuristic (≤ 2 sentence-ending punctuation marks).
 * - `backText`: trimmed, non-empty, max 3000 chars, plain text only.
 * - Unknown body keys are rejected (`strictObject`) so the client can never
 *   write to server-controlled columns (`user_id`, `created_by_ai`, SM-2, …).
 */

/** Front-text upper bound (mirrors the DB constraint / `db.md`). */
export const FRONT_TEXT_MAX_LENGTH = 500;

/** Back-text upper bound (mirrors the DB constraint / `db.md`). */
export const BACK_TEXT_MAX_LENGTH = 3000;

/** Maximum number of sentence-ending punctuation marks allowed in `frontText`. */
const MAX_FRONT_SENTENCE_TERMINATORS = 2;

/**
 * Conservative HTML-like markup detector. Rejects strings that contain an
 * opening/closing tag (`<tag …>`, `</tag>`) so flashcards stay plain text and
 * cannot smuggle markup into the UI. Kept intentionally simple and documented
 * by the validation tests.
 */
const HTML_LIKE_PATTERN = /<\/?[a-z][\s\S]*?>/i;

/** Return `true` when the value contains no HTML-like markup. */
function isPlainText(value: string): boolean {
  return !HTML_LIKE_PATTERN.test(value);
}

/**
 * Return `true` when the value reads like a short question, i.e. it contains no
 * more than {@link MAX_FRONT_SENTENCE_TERMINATORS} sentence-ending punctuation
 * marks (`.`, `?`, `!`).
 */
function isShortQuestion(value: string): boolean {
  const terminators = value.match(/[.?!]/g);
  return (terminators?.length ?? 0) <= MAX_FRONT_SENTENCE_TERMINATORS;
}

/**
 * Front-text rules: required, trimmed, non-empty, capped, plain text, and short.
 */
const frontTextSchema = z
  .string({ message: "Front text is required." })
  .trim()
  .min(1, "Front text must not be empty.")
  .max(FRONT_TEXT_MAX_LENGTH, `Front text must be at most ${FRONT_TEXT_MAX_LENGTH} characters long.`)
  .refine(isPlainText, "Front text must be plain text and must not contain HTML markup.")
  .refine(isShortQuestion, "Front text should be a short question (at most two sentences).");

/**
 * Back-text rules: required, trimmed, non-empty, capped, plain text.
 */
const backTextSchema = z
  .string({ message: "Back text is required." })
  .trim()
  .min(1, "Back text must not be empty.")
  .max(BACK_TEXT_MAX_LENGTH, `Back text must be at most ${BACK_TEXT_MAX_LENGTH} characters long.`)
  .refine(isPlainText, "Back text must be plain text and must not contain HTML markup.");

/**
 * Validation schema for the `POST /api/decks/{deckId}/flashcards` request body.
 * Unknown keys are rejected so the client can never write server-controlled
 * columns.
 */
export const createFlashcardSchema = z.strictObject({
  frontText: frontTextSchema,
  backText: backTextSchema,
});

/** Parsed and validated payload for creating a manual flashcard. */
export type CreateFlashcardInput = z.infer<typeof createFlashcardSchema>;

/**
 * Validation schema for the `deckId` path parameter on the flashcard endpoints.
 * `deckId` must be a valid UUID.
 */
export const deckIdParamSchema = z.object({
  deckId: z.uuid("Deck id must be a valid UUID."),
});

/**
 * Validation schema for the `flashcardId` path parameter on the single-flashcard
 * endpoints. `flashcardId` must be a valid UUID.
 */
export const flashcardIdParamSchema = z.object({
  flashcardId: z.uuid("Flashcard id must be a valid UUID."),
});

/** Parsed and validated `flashcardId` path parameter. */
export type FlashcardIdParam = z.infer<typeof flashcardIdParamSchema>;
