import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { getAiCredits, ProfileServiceError } from "@/lib/services/profile.service";
import type { GetAiCreditsResponseDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * GET /api/me/ai-credits — return the authenticated user's AI credit status.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  3. Delegate to `getAiCredits` and map domain errors to HTTP statuses.
 *  4. Return 200 with `GetAiCreditsResponseDto`.
 *
 * No CSRF/same-origin check: GET is a safe, read-only method.
 */
export const GET: APIRoute = async (context) => {
  // 1. Authentication — verify the session in the route, not just middleware.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to read AI credit status.");
  }

  // 2. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 3. Load credit status and map domain errors to HTTP responses.
  try {
    const result: GetAiCreditsResponseDto = await getAiCredits(supabase, user.id);
    // 4. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof ProfileServiceError) {
      if (error.code === "PROFILE_NOT_FOUND") {
        return jsonError(404, "PROFILE_NOT_FOUND", error.message);
      }
      // eslint-disable-next-line no-console
      console.error("[GET /api/me/ai-credits] credit fetch failed:", error.cause ?? error);
      return jsonError(500, "PROFILE_FETCH_FAILED", "Failed to load AI credit status.");
    }
    // eslint-disable-next-line no-console
    console.error("[GET /api/me/ai-credits] unexpected error:", error);
    return jsonError(500, "PROFILE_FETCH_FAILED", "Failed to load AI credit status.");
  }
};
