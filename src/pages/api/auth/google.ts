import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { jsonError } from "@/lib/api/responses";
import { startGoogleOAuthQuerySchema } from "@/lib/validation/auth";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/**
 * GET /api/auth/google — start the Supabase Google OAuth login flow.
 *
 * The route does not return JSON on success; it redirects the browser to the
 * Google consent screen produced by Supabase. After consent, Google redirects
 * back to `/api/auth/callback`, which exchanges the authorization code for a
 * session and forwards the user to the validated `redirectTo` path.
 *
 * Flow:
 *  1. Create the Supabase client → 500 `CONFIG_ERROR` when not configured.
 *  2. Parse + validate the `redirectTo` query param → 400 `INVALID_REDIRECT`.
 *  3. Build the app's own callback URL (carrying the validated `redirectTo`).
 *  4. Ask Supabase for the provider authorization URL → 500 `OAUTH_START_FAILED`.
 *  5. Redirect (302) to the provider consent screen.
 *
 * No session is required: this is the entry point to login. No CSRF check: the
 * OAuth handshake integrity is provided by Supabase's PKCE `state`.
 */
export const GET: APIRoute = async (context) => {
  // 1. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonError(500, "CONFIG_ERROR", "The server is not configured correctly.");
  }

  // 2. Query parsing + validation. An unsafe `redirectTo` (absolute or
  //    protocol-relative) is rejected to prevent open redirects.
  const searchParams = new URL(context.request.url).searchParams;
  const parsed = startGoogleOAuthQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return jsonError(400, "INVALID_REDIRECT", "The redirect path is not allowed.", {
      issues: z.treeifyError(parsed.error),
    });
  }

  // 3. Build the absolute callback URL on the app's own origin, forwarding the
  //    validated app-level `redirectTo` as a query parameter. The provider
  //    callback target is never a client-supplied absolute URL.
  const callbackUrl = new URL("/api/auth/callback", context.url.origin);
  callbackUrl.searchParams.set("redirectTo", parsed.data.redirectTo);

  // 4. Ask Supabase for the Google authorization URL (no DB access).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });

  if (error || !data.url) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/auth/google] OAuth start failed:", error);
    return jsonError(500, "OAUTH_START_FAILED", "Failed to start Google sign-in.");
  }

  // 5. Redirect the browser to the provider consent screen.
  return context.redirect(data.url, 302);
};
