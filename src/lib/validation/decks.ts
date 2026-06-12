import { z } from "zod";

/**
 * Validation schema for the `POST /api/decks` request body.
 *
 * Rules (mirrors the create-deck implementation plan):
 * - `name` is required, trimmed, non-empty after trimming, max 100 chars.
 * - Unknown keys are rejected (`strictObject`) so the client can never write
 *   to server-controlled columns such as `user_id`.
 */
export const createDeckSchema = z.strictObject({
  name: z
    .string({ message: "Deck name is required." })
    .trim()
    .min(1, "Deck name must not be empty.")
    .max(100, "Deck name must be at most 100 characters long."),
});

/** Parsed and validated payload for creating a deck. */
export type CreateDeckInput = z.infer<typeof createDeckSchema>;
