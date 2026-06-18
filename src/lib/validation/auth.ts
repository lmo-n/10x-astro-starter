import { z } from "zod";

/**
 * Validation helpers and schemas for the Google OAuth login flow
 * (`GET /api/auth/google`, `GET /api/auth/callback`).
 */

/** The default post-login destination when no `redirectTo` is supplied. */
export const DEFAULT_REDIRECT_PATH = "/dashboard";

/**
 * Return `true` only for safe, same-origin relative paths.
 *
 * A safe path starts with a single `/` and is not protocol-relative (`//host`)
 * or a back-reference (`/\host`). This prevents open-redirect attacks where a
 * client-supplied `redirectTo` could send the user to an external origin after
 * login. Absolute URLs (with a scheme) and protocol-relative URLs are rejected.
 */
export function isSafeRelativePath(path: string): boolean {
  // Must start with exactly one slash and not be protocol-relative (`//`) or a
  // backslash-escaped variant (`/\`) that some browsers normalize to `//`.
  return /^\/(?![/\\]).*/.test(path);
}

/**
 * Validation schema for the `GET /api/auth/google` query string.
 *
 * - `redirectTo`: optional relative path; defaults to {@link DEFAULT_REDIRECT_PATH}.
 *   Must be a safe same-origin path ({@link isSafeRelativePath}) to prevent open
 *   redirects.
 *
 * A plain (non-strict) object is used so unknown query parameters are ignored
 * rather than rejected, matching the existing list-endpoint style.
 */
export const startGoogleOAuthQuerySchema = z.object({
  redirectTo: z
    .string()
    .trim()
    .refine(isSafeRelativePath, "redirectTo must be a relative same-origin path.")
    .optional()
    .default(DEFAULT_REDIRECT_PATH),
});

/** Parsed and validated query parameters for starting Google OAuth. */
export type StartGoogleOAuthInput = z.infer<typeof startGoogleOAuthQuerySchema>;

/**
 * Coerce an untrusted `redirectTo` value into a safe relative path, falling back
 * to {@link DEFAULT_REDIRECT_PATH} when the value is missing or unsafe. Used by
 * the callback route, which must never throw on a bad `redirectTo`.
 */
export function safeRedirectPath(value: string | null | undefined): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isSafeRelativePath(trimmed)) {
      return trimmed;
    }
  }
  return DEFAULT_REDIRECT_PATH;
}
