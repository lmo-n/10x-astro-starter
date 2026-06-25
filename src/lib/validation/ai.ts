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
  model: z.enum(["gpt-4o-mini"]).default("gpt-4o-mini"),
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
