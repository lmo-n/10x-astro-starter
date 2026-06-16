import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { flashcardIdParamSchema } from "@/lib/validation/flashcards";
import { deleteFlashcard, FlashcardServiceError } from "@/lib/services/flashcard.service";
import type { DeleteFlashcardResponseDto } from "@/types";

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
