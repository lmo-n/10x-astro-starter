import { z } from "zod";

/**
 * Shared deck `name` rules, reused by the create and rename schemas.
 * - required, trimmed, non-empty after trimming, max 100 chars.
 */
const deckNameSchema = z
  .string({ message: "Deck name is required." })
  .trim()
  .min(1, "Deck name must not be empty.")
  .max(100, "Deck name must be at most 100 characters long.");

/**
 * Validation schema for the `POST /api/decks` request body.
 *
 * Rules (mirrors the create-deck implementation plan):
 * - `name` is required, trimmed, non-empty after trimming, max 100 chars.
 * - Unknown keys are rejected (`strictObject`) so the client can never write
 *   to server-controlled columns such as `user_id`.
 */
export const createDeckSchema = z.strictObject({
  name: deckNameSchema,
});

/** Parsed and validated payload for creating a deck. */
export type CreateDeckInput = z.infer<typeof createDeckSchema>;

/**
 * Validation schema for the `PATCH /api/decks/{deckId}` request body.
 *
 * `name` is the only mutable field and reuses the same rules as create.
 * Unknown keys are rejected (`strictObject`) so the client can never write to
 * server-controlled columns.
 */
export const renameDeckSchema = z.strictObject({
  name: deckNameSchema,
});

/** Parsed and validated payload for renaming a deck. */
export type RenameDeckInput = z.infer<typeof renameDeckSchema>;

/**
 * Validation schema for the `deckId` path parameter shared by the single-deck
 * endpoints (`GET`/`PATCH`/`DELETE /api/decks/{deckId}`). `deckId` must be a
 * valid UUID.
 */
export const deckIdParamSchema = z.object({
  deckId: z.uuid("Deck id must be a valid UUID."),
});

/**
 * Validation schema for the `GET /api/decks` query string.
 *
 * Rules (mirrors the list-decks implementation plan):
 * - `limit`: coerced integer, default `20`, min `1`, capped at `100`.
 * - `cursor`: opaque, optional pagination token from a previous response.
 * - `sort`: whitelisted column, default `createdAt` (prevents ordering injection).
 * - `order`: `asc` | `desc`, default `desc`.
 * - `search`: trimmed, non-empty case-insensitive name filter (optional).
 *
 * A plain (non-strict) object is used so unknown query parameters are ignored
 * rather than rejected, per the plan.
 */
export const listDecksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  sort: z.enum(["createdAt", "updatedAt", "name"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().min(1).optional(),
});

/** Parsed and validated query parameters for listing decks. */
export type ListDecksInput = z.infer<typeof listDecksQuerySchema>;
