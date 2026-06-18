import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { submitReviewSchema } from "@/lib/validation/study";
import { submitStudyReview, StudyServiceError } from "@/lib/services/study.service";
import type { SubmitReviewCommand, SubmitReviewResponseDto } from "@/types";

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
 * POST /api/study/reviews — record a study review for one of the authenticated
 * user's flashcards and update its SM-2 scheduling state.
 *
 * The client submits only `flashcardId` and `grade`; the server computes all
 * SM-2 changes and returns the updated card plus the remaining due-card count.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Same-origin check (CSRF) → 403 otherwise.
 *  3. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  4. Parse + validate the JSON body with Zod → 400 on failure.
 *  5. Delegate to `submitStudyReview` and map domain errors to HTTP statuses.
 *  6. Return 200 with `SubmitReviewResponseDto`.
 */
export const POST: APIRoute = async (context) => {
  // 1. Authentication — the route verifies the session itself, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to submit a review.");
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

  // 4. Body parsing + validation. The strict schema rejects unknown fields so
  //    clients cannot submit SM-2 state directly.
  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return jsonError(400, "INVALID_BODY", "Request body must be valid JSON.");
  }

  const parsed = submitReviewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_REVIEW_PAYLOAD", "Review payload is invalid.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  const command: SubmitReviewCommand = parsed.data;

  // 5. Submit the review and map domain errors to HTTP responses.
  try {
    const result: SubmitReviewResponseDto = await submitStudyReview(supabase, user.id, command);
    // 6. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof StudyServiceError) {
      if (error.code === "FLASHCARD_NOT_FOUND") {
        return jsonError(404, "FLASHCARD_NOT_FOUND", "Flashcard not found.");
      }
      // eslint-disable-next-line no-console
      console.error("[POST /api/study/reviews] review save failed:", error.cause ?? error);
      return jsonError(500, "REVIEW_SAVE_FAILED", "Failed to save the review.");
    }
    // eslint-disable-next-line no-console
    console.error("[POST /api/study/reviews] unexpected error:", error);
    return jsonError(500, "REVIEW_SAVE_FAILED", "Failed to save the review.");
  }
};
