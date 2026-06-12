import type { ApiErrorDto } from "@/types";

/**
 * Shared JSON response helpers for API routes.
 *
 * All error responses use the consistent {@link ApiErrorDto} envelope so the
 * client always receives `{ error: { code, message, details? } }`.
 */

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** Build a JSON success response with the given status code (default `200`). */
export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Build a JSON error response wrapped in the {@link ApiErrorDto} envelope. */
export function jsonError(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  const payload: ApiErrorDto = {
    error: { code, message, ...(details ? { details } : {}) },
  };
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
