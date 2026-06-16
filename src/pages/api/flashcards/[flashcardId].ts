import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { flashcardIdParamSchema, IMMUTABLE_FLASHCARD_KEYS, updateFlashcardSchema } from "@/lib/validation/flashcards";
import {
  deleteFlashcard,
  updateFlashcard,
  FlashcardServiceError,
} from "@/lib/services/flashcard.service";
import type { DeleteFlashcardResponseDto, UpdateFlashcardResponseDto } from "@/types";

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
 * DELETE /api/flashcards/{flashcardId} — permanently delete a single flashcard
 * owned by the authenticated user. Deletion is physical and does not touch the
 * parent deck, other flashcards, AI generation logs, or AI credits.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Validate the `flashcardId` path parameter as a UUID → 400 otherwise.
 *  5. Delegate to `deleteFlashcard` and map domain errors to HTTP statuses.
 *  6. Return 200 with `DeleteFlashcardResponseDto`.
 */
export const DELETE: APIRoute = async (context) => {
  // 1. Authentication — the route verifies the session itself, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to delete a flashcard.");
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
  const params = flashcardIdParamSchema.safeParse(context.params);
  if (!params.success) {
    return jsonError(400, "INVALID_FLASHCARD_ID", "Flashcard id is invalid.", {
      issues: z.treeifyError(params.error),
    });
  }

  // 5. Delete the flashcard and map domain errors to HTTP responses.
  try {
    await deleteFlashcard(supabase, user.id, params.data.flashcardId);
    // 6. Success.
    const body: DeleteFlashcardResponseDto = { message: "Flashcard deleted successfully" };
    return jsonOk(body, 200);
  } catch (error) {
    if (error instanceof FlashcardServiceError) {
      if (error.code === "FLASHCARD_NOT_FOUND") {
        return jsonError(404, "FLASHCARD_NOT_FOUND", "Flashcard not found.");
      }
      // eslint-disable-next-line no-console
      console.error("[DELETE /api/flashcards/:flashcardId] flashcard deletion failed:", error.cause ?? error);
      return jsonError(500, "FLASHCARD_DELETE_FAILED", "Failed to delete flashcard.");
    }
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/flashcards/:flashcardId] unexpected error:", error);
    return jsonError(500, "FLASHCARD_DELETE_FAILED", "Failed to delete flashcard.");
  }
};

/**
 * PATCH /api/flashcards/{flashcardId} — update the text fields of a single
 * flashcard owned by the authenticated user. Only `frontText` and/or `backText`
 * may be changed; SM-2 state, deck membership, and all other fields are immutable.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Validate the `flashcardId` path parameter as a UUID → 400 otherwise.
 *  5. Parse JSON body → 400 `INVALID_BODY` on failure.
 *  6. Reject immutable fields in the body → 400 `IMMUTABLE_FLASHCARD_FIELDS`.
 *  7. Validate editable fields with `updateFlashcardSchema` → 400 `INVALID_FLASHCARD_TEXT`.
 *  8. Delegate to `updateFlashcard` and map domain errors to HTTP statuses.
 *  9. Return 200 with `UpdateFlashcardResponseDto`.
 */
export const PATCH: APIRoute = async (context) => {
  // 1. Authentication.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to update a flashcard.");
  }

  // 2. CSRF.
  if (!isSameOrigin(context.request)) {
    return jsonError(403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed.");
  }

  // 3. Supabase client.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 4. Path parameter validation.
  const params = flashcardIdParamSchema.safeParse(context.params);
  if (!params.success) {
    return jsonError(400, "INVALID_FLASHCARD_ID", "Flashcard id is invalid.", {
      issues: z.treeifyError(params.error),
    });
  }

  // 5. Parse JSON body.
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  // 6. Reject immutable fields before running Zod.
  if (typeof body === "object" && body !== null) {
    const presentImmutable = Object.keys(body).filter((key) => IMMUTABLE_FLASHCARD_KEYS.has(key));
    if (presentImmutable.length > 0) {
      return jsonError(400, "IMMUTABLE_FLASHCARD_FIELDS", "Only frontText and backText can be updated.");
    }
  }

  // 7. Validate editable fields.
  const parsed = updateFlashcardSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "INVALID_FLASHCARD_TEXT", "Flashcard text is invalid.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  // 8. Update the flashcard and map domain errors.
  try {
    const result: UpdateFlashcardResponseDto = await updateFlashcard(
      supabase,
      user.id,
      params.data.flashcardId,
      parsed.data,
    );
    // 9. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof FlashcardServiceError) {
      if (error.code === "FLASHCARD_NOT_FOUND") {
        return jsonError(404, "FLASHCARD_NOT_FOUND", "Flashcard not found.");
      }
      // eslint-disable-next-line no-console
      console.error("[PATCH /api/flashcards/:flashcardId] flashcard update failed:", error.cause ?? error);
      return jsonError(500, "FLASHCARD_UPDATE_FAILED", "Failed to update flashcard.");
    }
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/flashcards/:flashcardId] unexpected error:", error);
    return jsonError(500, "FLASHCARD_UPDATE_FAILED", "Failed to update flashcard.");
  }
};
