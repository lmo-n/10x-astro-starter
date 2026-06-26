import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { analyticsSummaryQuerySchema } from "@/lib/validation/ai";
import { getAnalyticsSummary, AiServiceError } from "@/lib/services/ai.service";
import type { GetAnalyticsSummaryResponseDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * GET /api/analytics/summary — return MVP success-metric aggregates.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  3. Parse + validate query string with Zod → 400 on failure.
 *  4. Delegate to `getAnalyticsSummary` and map domain errors to HTTP statuses.
 *  5. Return 200 with `GetAnalyticsSummaryResponseDto`.
 *
 * No CSRF check: GET is a safe, read-only method.
 */
export const GET: APIRoute = async (context) => {
  // 1. Authentication.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to read analytics.");
  }

  // 2. Supabase client.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 3. Query string validation.
  const rawQuery = Object.fromEntries(new URL(context.request.url).searchParams);
  const parsed = analyticsSummaryQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return jsonError(400, "INVALID_QUERY", "Invalid query parameters.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  // 4. Compute analytics and map domain errors to HTTP responses.
  try {
    const result: GetAnalyticsSummaryResponseDto = await getAnalyticsSummary(supabase, user.id, parsed.data);
    // 5. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof AiServiceError) {
      if (error.code === "DECK_NOT_FOUND") {
        return jsonError(404, "DECK_NOT_FOUND", "Deck not found or access denied.");
      }
      if (error.code === "INVALID_QUERY") {
        return jsonError(400, "INVALID_QUERY", error.message);
      }
      // eslint-disable-next-line no-console
      console.error("[GET /api/analytics/summary] failed:", error.cause ?? error);
      return jsonError(500, "ANALYTICS_FAILED", "Failed to load analytics.");
    }
    // eslint-disable-next-line no-console
    console.error("[GET /api/analytics/summary] unexpected error:", error);
    return jsonError(500, "ANALYTICS_FAILED", "Failed to load analytics.");
  }
};
