import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { createDeckSchema } from "@/lib/validation/decks";
import { createDeck, DeckServiceError } from "@/lib/services/deck.service";
import type { CreateDeckCommand, CreateDeckResponseDto } from "@/types";

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
 * POST /api/decks — create a new deck for the authenticated user.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Parse + validate the JSON body with Zod → 400 on failure.
 *  5. Delegate to `createDeck` and map domain errors to HTTP statuses.
 *  6. Return 201 with `CreateDeckResponseDto`.
 */
export const POST: APIRoute = async (context) => {
  // 1. Authentication — the route verifies the session itself, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to create a deck.");
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

  // 4. Body parsing + validation.
  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = createDeckSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_DECK_NAME", "Deck name is invalid.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  const command: CreateDeckCommand = parsed.data;

  // 5. Create the deck and map domain errors to HTTP responses.
  try {
    const result: CreateDeckResponseDto = await createDeck(supabase, user.id, command);
    // 6. Success.
    return jsonOk(result, 201);
  } catch (error) {
    if (error instanceof DeckServiceError) {
      if (error.code === "DECK_LIMIT_REACHED") {
        return jsonError(409, "DECK_LIMIT_REACHED", error.message);
      }
      // eslint-disable-next-line no-console
      console.error("[POST /api/decks] deck creation failed:", error.cause ?? error);
      return jsonError(500, "DECK_CREATE_FAILED", "Failed to create deck.");
    }
    // eslint-disable-next-line no-console
    console.error("[POST /api/decks] unexpected error:", error);
    return jsonError(500, "DECK_CREATE_FAILED", "Failed to create deck.");
  }
};
