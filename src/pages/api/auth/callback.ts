import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { DEFAULT_REDIRECT_PATH, safeRedirectPath } from "@/lib/validation/auth";

// SSR route: must not be prerendered so it runs per-request on Cloudflare Workers.
export const prerender = false;

/** Friendly, non-technical message shown on the sign-in page after a failure. */
const SIGNIN_ERROR_MESSAGE = "Google sign-in could not be completed. Please try again.";

/** Build the sign-in redirect URL carrying a friendly error message. */
function signInWithError(message: string): string {
  return `/auth/signin?error=${encodeURIComponent(message)}`;
}

/**
 * GET /api/auth/callback — complete the Supabase Google OAuth login flow.
 *
 * Google redirects here after consent with an authorization `code`. The route
 * exchanges that code for a session (the `@supabase/ssr` client writes the
 * session cookies) and forwards the user to the validated `redirectTo` path.
 *
 * Every failure path resolves to a rendered page (the sign-in page with a
 * friendly message), never raw JSON, so the browser always lands somewhere
 * usable.
 *
 * Flow:
 *  1. Read `code`, `error`, and `redirectTo` from the query string.
 *  2. If the provider reported an error or no `code` is present → sign-in page.
 *  3. Create the Supabase client → sign-in page when not configured.
 *  4. Exchange the code for a session → sign-in page on failure.
 *  5. Redirect (302) to the validated `redirectTo` (default `/dashboard`).
 */
export const GET: APIRoute = async (context) => {
  const searchParams = new URL(context.request.url).searchParams;
  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  // Re-validate the forwarded redirect; never trust it blindly.
  const redirectTo = safeRedirectPath(searchParams.get("redirectTo"));

  // 2. Provider denied/cancelled consent, or no authorization code was returned.
  if (providerError || !code) {
    return context.redirect(signInWithError(SIGNIN_ERROR_MESSAGE), 302);
  }

  // 3. Supabase client — guard against missing configuration.
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(signInWithError("The server is not configured correctly."), 302);
  }

  // 4. Exchange the authorization code for a session (sets cookies via the SSR
  //    client's cookie adapter). Never log the code or tokens.
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/auth/callback] code exchange failed:", error.message);
    return context.redirect(signInWithError(SIGNIN_ERROR_MESSAGE), 302);
  }

  // 5. Success — forward to the originally requested path (default /dashboard).
  return context.redirect(redirectTo || DEFAULT_REDIRECT_PATH, 302);
};
