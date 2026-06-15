import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { deckIdParamSchema, renameDeckSchema } from "@/lib/validation/decks";
import { renameDeck, deleteDeck, DeckServiceError } from "@/lib/services/deck.service";
import type { DeleteDeckResponseDto, RenameDeckCommand, RenameDeckResponseDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * Reject cross-origin cookie-authenticated writes (basic CSRF defence).
 * For same-origin requests the browser sends `Origin` matching the request URL;
 * we allow requests with no `Origin` header (e.g. server-to-server / tests).
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return true;
  }
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * PATCH /api/decks/{deckId} — rename a deck owned by the authenticated user.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Validate the `deckId` path parameter as a UUID → 400 otherwise.
 *  5. Parse + validate the JSON body with Zod → 400 on failure.
 *  6. Delegate to `renameDeck` and map domain errors to HTTP statuses.
 *  7. Return 200 with `RenameDeckResponseDto`.
 */
export const PATCH: APIRoute = async (context) => {
  // 1. Authentication — the route verifies the session itself, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to rename a deck.");
  }

  // 2. CSRF — reject cross-origin cookie-authenticated mutations.
  if (!isSameOrigin(context.request)) {
    return jsonError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
  }

  // 3. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 4. Path parameter validation.
  const params = deckIdParamSchema.safeParse(context.params);
  if (!params.success) {
    return jsonError(400, "INVALID_DECK_ID", "Deck id is invalid.", {
      issues: z.treeifyError(params.error),
    });
  }

  // 5. Body parsing + validation.
  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = renameDeckSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_DECK_NAME", "Deck name is invalid.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  const command: RenameDeckCommand = parsed.data;

  // 6. Rename the deck and map domain errors to HTTP responses.
  try {
    const result: RenameDeckResponseDto = await renameDeck(supabase, user.id, params.data.deckId, command);
    // 7. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof DeckServiceError) {
      if (error.code === "DECK_NOT_FOUND") {
        return jsonError(404, "DECK_NOT_FOUND", "Deck not found.");
      }
      // eslint-disable-next-line no-console
      console.error("[PATCH /api/decks/:deckId] deck rename failed:", error.cause ?? error);
      return jsonError(500, "DECK_UPDATE_FAILED", "Failed to rename deck.");
    }
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/decks/:deckId] unexpected error:", error);
    return jsonError(500, "DECK_UPDATE_FAILED", "Failed to rename deck.");
  }
};

/**
 * DELETE /api/decks/{deckId} — permanently delete a deck owned by the
 * authenticated user. The database cascade removes the deck's flashcards.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Validate the `deckId` path parameter as a UUID → 400 otherwise.
 *  5. Delegate to `deleteDeck` and map domain errors to HTTP statuses.
 *  6. Return 200 with `DeleteDeckResponseDto`.
 */
export const DELETE: APIRoute = async (context) => {
  // 1. Authentication — the route verifies the session itself, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to delete a deck.");
  }

  // 2. CSRF — reject cross-origin cookie-authenticated mutations.
  if (!isSameOrigin(context.request)) {
    return jsonError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
  }

  // 3. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 4. Path parameter validation.
  const params = deckIdParamSchema.safeParse(context.params);
  if (!params.success) {
    return jsonError(400, "INVALID_DECK_ID", "Deck id is invalid.", {
      issues: z.treeifyError(params.error),
    });
  }

  // 5. Delete the deck and map domain errors to HTTP responses.
  try {
    await deleteDeck(supabase, user.id, params.data.deckId);
    // 6. Success.
    const body: DeleteDeckResponseDto = { message: "Deck deleted successfully" };
    return jsonOk(body, 200);
  } catch (error) {
    if (error instanceof DeckServiceError) {
      if (error.code === "DECK_NOT_FOUND") {
        return jsonError(404, "DECK_NOT_FOUND", "Deck not found.");
      }
      // eslint-disable-next-line no-console
      console.error("[DELETE /api/decks/:deckId] deck deletion failed:", error.cause ?? error);
      return jsonError(500, "DECK_DELETE_FAILED", "Failed to delete deck.");
    }
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/decks/:deckId] unexpected error:", error);
    return jsonError(500, "DECK_DELETE_FAILED", "Failed to delete deck.");
  }
};
