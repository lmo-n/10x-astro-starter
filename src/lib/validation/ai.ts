import { z } from "zod";

/** Minimum source text length (characters) for AI generation. */
export const SOURCE_TEXT_MIN_LENGTH = 20;

/** Maximum source text length (characters) for AI generation. */
export const SOURCE_TEXT_MAX_LENGTH = 10000;

/** Maximum length for the optional AI instructions field. */
export const INSTRUCTIONS_MAX_LENGTH = 500;

/**
 * Validation schema for `POST /api/ai/generate`.
 * Mirrors {@link GenerateProposalsCommand} from `src/types.ts`.
 */
export const generateFlashcardsSchema = z.strictObject({
  sourceText: z
    .string()
    .trim()
    .min(SOURCE_TEXT_MIN_LENGTH, `Source text must be at least ${SOURCE_TEXT_MIN_LENGTH} characters.`)
    .max(SOURCE_TEXT_MAX_LENGTH, `Source text must be at most ${SOURCE_TEXT_MAX_LENGTH} characters.`),
  instructions: z
    .string()
    .max(INSTRUCTIONS_MAX_LENGTH, `Instructions must be at most ${INSTRUCTIONS_MAX_LENGTH} characters.`)
    .optional(),
  language: z.enum(["pl", "en", "auto"]).default("auto"),
  model: z.enum(["openai/gpt-4o-mini", "anthropic/claude-3-haiku"]).default("openai/gpt-4o-mini"),
});

/**
 * Validation schema for `POST /api/ai/approve`.
 * Mirrors {@link ApproveAiFlashcardsCommand} from `src/types.ts`.
 */
export const approveAiFlashcardsSchema = z.strictObject({
  deckId: z.string().uuid("Deck id must be a valid UUID."),
  proposedCardsCount: z.number().int().min(0),
  model: z.string().min(1),
  cards: z
    .array(
      z.object({
        frontText: z.string().trim().min(1).max(500),
        backText: z.string().trim().min(1).max(3000),
      }),
    )
    .min(1, "At least one card must be approved."),
});

/** ISO date string `YYYY-MM-DD`. */
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

/**
 * Validation schema for the `GET /api/ai/generation-logs` query string.
 *
 * - `limit`: coerced integer, default `20`, capped at `100`.
 * - `cursor`: opaque pagination token (base64-JSON keyset anchor).
 * - `deckId`: optional UUID filter.
 * - `from` / `to`: optional `YYYY-MM-DD` date range (inclusive).
 * - `sort`: only `"createdAt"` is supported.
 * - `order`: `"asc" | "desc"`, default `"desc"`.
 */
export const listGenerationLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  deckId: z.string().uuid("deckId must be a valid UUID.").optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  sort: z.enum(["createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/** Parsed and validated query parameters for listing generation logs. */
export type ListGenerationLogsInput = z.infer<typeof listGenerationLogsQuerySchema>;

/**
 * Validation schema for `GET /api/analytics/summary`.
 *
 * All three parameters are optional:
 * - `deckId`: UUID to scope both log and flashcard aggregates to one deck.
 * - `from` / `to`: `YYYY-MM-DD` date range applied to `created_at`.
 */
export const analyticsSummaryQuerySchema = z.object({
  deckId: z.string().uuid("deckId must be a valid UUID.").optional(),
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});

/** Parsed and validated query parameters for the analytics summary. */
export type AnalyticsSummaryInput = z.infer<typeof analyticsSummaryQuerySchema>;
