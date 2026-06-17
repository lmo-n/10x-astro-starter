import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { studyDueQuerySchema } from "@/lib/validation/study";
import { getDueStudyQueue, StudyServiceError } from "@/lib/services/study.service";
import type { GetStudyDueResponseDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * GET /api/study/due — return the authenticated user's due-card study queue,
 * optionally scoped to one owned deck, with cursor pagination and a summary.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  3. Parse + validate the query string with Zod → 400 `INVALID_QUERY` on failure.
 *  4. Delegate to `getDueStudyQueue` and map domain errors to HTTP statuses.
 *  5. Return 200 with `GetStudyDueResponseDto`.
 *
 * No CSRF/same-origin check: GET is a safe, read-only method.
 */
export const GET: APIRoute = async (context) => {
  // 1. Authentication — verify the session in the route, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to load the study queue.");
  }

  // 2. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 3. Query parsing + validation. Unknown params are ignored; recognized ones
  //    must pass validation.
  const searchParams = new URL(context.request.url).searchParams;
  const parsed = studyDueQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return jsonError(400, "INVALID_QUERY", "Query parameters are invalid.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  // 4. Build the due queue and map domain errors to HTTP responses.
  try {
    const result: GetStudyDueResponseDto = await getDueStudyQueue(supabase, user.id, parsed.data);
    // 5. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof StudyServiceError) {
      if (error.code === "DECK_NOT_FOUND") {
        return jsonError(404, "DECK_NOT_FOUND", error.message);
      }
      if (error.code === "INVALID_QUERY") {
        return jsonError(400, "INVALID_QUERY", error.message);
      }
      // eslint-disable-next-line no-console
      console.error("[GET /api/study/due] study queue failed:", error.cause ?? error);
      return jsonError(500, "STUDY_QUEUE_FAILED", "Failed to load the study queue.");
    }
    // eslint-disable-next-line no-console
    console.error("[GET /api/study/due] unexpected error:", error);
    return jsonError(500, "STUDY_QUEUE_FAILED", "Failed to load the study queue.");
  }
};
