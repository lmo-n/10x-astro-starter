import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError, jsonOk } from "@/lib/api/responses";
import { listGenerationLogsQuerySchema } from "@/lib/validation/ai";
import { listGenerationLogs, AiServiceError } from "@/lib/services/ai.service";
import type { ListGenerationLogsResponseDto } from "@/types";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * GET /api/ai/generation-logs — list the authenticated user's AI generation history.
 *
 * Flow:
 *  1. Require an authenticated session (`context.locals.user`) → 401 otherwise.
 *  2. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  3. Parse + validate query string with Zod → 400 on failure.
 *  4. Delegate to `listGenerationLogs` and map domain errors to HTTP statuses.
 *  5. Return 200 with `ListGenerationLogsResponseDto`.
 *
 * No CSRF check: GET is a safe, read-only method.
 */
export const GET: APIRoute = async (context) => {
  // 1. Authentication.
  const user = context.locals.user;
  if (!user) {
    return jsonError(401, "AUTH_REQUIRED", "Authentication is required to list generation logs.");
  }

  // 2. Supabase client.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 3. Query string validation.
  const rawQuery = Object.fromEntries(new URL(context.request.url).searchParams);
  const parsed = listGenerationLogsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return jsonError(400, "INVALID_QUERY", "Invalid query parameters.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  // 4. Load logs and map domain errors to HTTP responses.
  try {
    const result: ListGenerationLogsResponseDto = await listGenerationLogs(supabase, user.id, parsed.data);
    // 5. Success.
    return jsonOk(result, 200);
  } catch (error) {
    if (error instanceof AiServiceError) {
      if (error.code === "INVALID_QUERY") {
        return jsonError(400, "INVALID_QUERY", error.message);
      }
      // eslint-disable-next-line no-console
      console.error("[GET /api/ai/generation-logs] list failed:", error.cause ?? error);
      return jsonError(500, "AI_LIST_FAILED", "Failed to load generation logs.");
    }
    // eslint-disable-next-line no-console
    console.error("[GET /api/ai/generation-logs] unexpected error:", error);
    return jsonError(500, "AI_LIST_FAILED", "Failed to load generation logs.");
  }
};
