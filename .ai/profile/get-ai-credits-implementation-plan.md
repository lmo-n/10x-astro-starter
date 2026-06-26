# API Endpoint Implementation Plan: GET /api/me/ai-credits

## 1. Endpoint Overview

Returns the authenticated user's AI credit status in a user-friendly format
suitable for the generation UI (progress bar, friendly text). It is a focused
subset of `GET /api/me` — only the credit fields and a computed human-readable
message are returned, with no dashboard counters.

Key business rules:

- Only the profile where `id = auth.uid()` is returned (RLS + explicit filter).
- `remaining` is computed as `ai_credits_limit - ai_credits_used`.
- `message` is a non-technical string (e.g. "You can generate 75 more
  flashcards this period.") — never exposes terms like "API tokens".
- `userId` is always derived from the session, never from the request.

## 2. Request Details

- **HTTP Method:** `GET`
- **URL:** `/api/me/ai-credits`
- **Headers:** Supabase session cookies (required for authentication)
- **Parameters:** none
- **Request body:** none

## 3. Types Used

All types are already present in [src/types.ts](src/types.ts):

- `AiCreditsDto` — `{ limit, used, remaining, resetDate, message }`.
- `GetAiCreditsResponseDto` — `{ aiCredits: AiCreditsDto }`.
- `UsersProfileRow` — source database row (column access via index types).
- `ApiErrorDto` — consistent error envelope.

Existing service error types in `profile.service.ts` are reused:

- `ProfileServiceErrorCode` — `"PROFILE_NOT_FOUND" | "PROFILE_FETCH_FAILED"`.
- `ProfileServiceError` — domain error class, already exported.

## 4. Response Details

**Success — 200 OK:**

```json
{
  "aiCredits": {
    "limit": 100,
    "used": 25,
    "remaining": 75,
    "resetDate": "2026-07-11",
    "message": "You can generate 75 more flashcards this period."
  }
}
```

**Status codes:**

- `200 OK` — credit status returned.
- `401 Unauthorized` — `AUTH_REQUIRED`, no active session.
- `404 Not Found` — `PROFILE_NOT_FOUND`, profile row is missing.
- `500 Internal Server Error` — `CONFIG_ERROR` or `PROFILE_FETCH_FAILED`.

## 5. Data Flow

1. Route reads `context.locals.user` (set by middleware).
2. No user → `401 AUTH_REQUIRED`.
3. `createClient(request.headers, cookies)` returns `null` → `500 CONFIG_ERROR`.
4. Route calls `getAiCredits(supabase, user.id)` from `profile.service.ts`.
5. Service runs a single `SELECT` on `users_profiles`:
   - columns: `ai_credits_limit`, `ai_credits_used`, `ai_credits_reset_date`
   - filter: `id = userId` (`.maybeSingle()`)
6. Missing row → `ProfileServiceError("PROFILE_NOT_FOUND")` → route returns `404`.
7. Query failure → `ProfileServiceError("PROFILE_FETCH_FAILED")` → `500`.
8. Service computes `remaining = limit - used` and builds the `message` string.
9. Route returns `200` with `GetAiCreditsResponseDto` via `jsonOk(result, 200)`.

## 6. Service Function

Add `getAiCredits` to `src/lib/services/profile.service.ts`:

```ts
export async function getAiCredits(
  supabase: SupabaseClient,
  userId: string
): Promise<GetAiCreditsResponseDto>
```

- Selects only `ai_credits_limit`, `ai_credits_used`, `ai_credits_reset_date`.
- Computes `remaining` and `message`.
- `message` template: `"You can generate {remaining} more flashcard(s) this period."`.
  When `remaining === 0`: `"You have used all your AI generations for this period."`.

## 7. Security Considerations

- Same auth/authz model as `GET /api/me`: session-only `userId`, RLS + explicit
  `.eq("id", userId)`.
- No CSRF check needed (read-only GET).
- No sensitive fields logged in `console.error`.

## 8. Error Handling

| Scenario                | Code | `error.code`           |
| ----------------------- | ---- | ---------------------- |
| No session              | 401  | `AUTH_REQUIRED`        |
| Supabase not configured | 500  | `CONFIG_ERROR`         |
| Profile row missing     | 404  | `PROFILE_NOT_FOUND`    |
| Database query error    | 500  | `PROFILE_FETCH_FAILED` |
| Unexpected exception    | 500  | `PROFILE_FETCH_FAILED` |

## 9. Files Affected

| File | Change |
|---|---|
| `src/lib/services/profile.service.ts` | Add `getAiCredits` function |
| `src/pages/api/me/ai-credits.ts` | New route file |
