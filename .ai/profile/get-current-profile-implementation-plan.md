# API Endpoint Implementation Plan: GET /api/me (Current User Profile)

## 1. Endpoint Overview

This endpoint returns the profile of the currently authenticated user together
with a set of counters (statistics) used by the dashboard view. It combines data
from the `users_profiles` table (plan, AI credits) with aggregates from the
`decks` and `flashcards` tables (deck count, due/total/AI flashcard counts). It
is a read-only operation, restricted to the profile owner via RLS and an
explicit `id = auth.uid()` filter.

The endpoint is server-side rendered (Astro SSR on Cloudflare Workers) and
requires an active Supabase session. It follows the same conventions as the
already implemented deck endpoints
([src/pages/api/decks.ts](src/pages/api/decks.ts)) and service module
([src/lib/services/deck.service.ts](src/lib/services/deck.service.ts)).

Key business rules:

- Only the profile where `id = auth.uid()` is returned (enforced by RLS and the
  explicit session boundary in the route).
- `aiCreditsRemaining` is computed as `ai_credits_limit - ai_credits_used`.
- `stats.deckLimit` is the configured MVP cap (`120`), shared with `DECK_LIMIT`
  in [src/lib/services/deck.service.ts](src/lib/services/deck.service.ts).
- `userId` is always derived from the session, never from the request.

## 2. Request Details

- **HTTP Method:** `GET`
- **URL:** `/api/me`
- **Headers:**
  - Supabase session cookies (required for authentication)
- **Parameters:**
  - **Required:** none
  - **Optional:** none
- **Request Body:** none (GET request).

## 3. Types Used

All DTOs are sourced from [src/types.ts](src/types.ts):

- `GetProfileResponseDto` — response shape: `{ profile: ProfileDto, stats: ProfileStatsDto }`.
- `ProfileDto` — mapped profile (camelCase) with the computed `aiCreditsRemaining`.
- `ProfileStatsDto` — counters: `deckCount`, `deckLimit`, `dueFlashcardsCount`,
  `totalFlashcardsCount`, `aiCreatedFlashcardsCount`.
- `UsersProfileRow` — source database row type.
- `ApiErrorDto` — consistent error envelope `{ error: { code, message, details? } }`.

New service error type (in `profile.service.ts`):

- `ProfileServiceErrorCode = "PROFILE_NOT_FOUND" | "PROFILE_FETCH_FAILED"`.
- `class ProfileServiceError extends Error` (mirrors `DeckServiceError`).

## 4. Response Details

**Success — 200 OK:**

```json
{
  "profile": {
    "id": "uuid",
    "planType": "free",
    "aiCreditsLimit": 50,
    "aiCreditsUsed": 12,
    "aiCreditsRemaining": 38,
    "aiCreditsResetDate": "2026-07-01",
    "createdAt": "2026-06-01T10:00:00.000Z",
    "updatedAt": "2026-06-18T08:30:00.000Z"
  },
  "stats": {
    "deckCount": 7,
    "deckLimit": 120,
    "dueFlashcardsCount": 33,
    "totalFlashcardsCount": 210,
    "aiCreatedFlashcardsCount": 95
  }
}
```

**Status codes:**

- `200 OK` — profile and statistics returned.
- `401 Unauthorized` — `AUTH_REQUIRED`, no active session.
- `404 Not Found` — `PROFILE_NOT_FOUND`, profile row is missing.
- `500 Internal Server Error` — `CONFIG_ERROR` (Supabase not configured) or
  `PROFILE_FETCH_FAILED` (unexpected query failure).

## 5. Data Flow

1. The `GET /api/me` route reads `context.locals.user` (set in
   [src/middleware.ts](src/middleware.ts)).
2. If there is no user → `401 AUTH_REQUIRED`.
3. It creates the Supabase client: `createClient(request.headers, cookies)`; if
   `null` → `500 CONFIG_ERROR`.
4. It calls `getProfile(supabase, user.id)` from `profile.service.ts`.
5. The service runs in parallel (`Promise.all`):
   - `SELECT` a single row from `users_profiles` filtered by `id = userId`
     (`.maybeSingle()`).
   - `COUNT` the user's decks (`decks`, `user_id = userId`, `head: true`).
   - `COUNT` all flashcards (`flashcards`, `user_id = userId`).
   - `COUNT` due flashcards (`flashcards`, `user_id = userId`, `due_at <= current_date`).
   - `COUNT` AI flashcards (`flashcards`, `user_id = userId`, `created_by_ai = true`).
6. If the profile row does not exist → `ProfileServiceError("PROFILE_NOT_FOUND")`
   → the route maps it to `404`.
7. The service maps the row to `ProfileDto` (camelCase + `aiCreditsRemaining`)
   and builds `ProfileStatsDto` (with `deckLimit = DECK_LIMIT`).
8. The route returns `200` with `GetProfileResponseDto` via `jsonOk(result, 200)`.

All queries pass through Supabase RLS, which provides a second authorization
layer alongside the explicit `eq("...", userId)` filter.

## 6. Security Considerations

- **Authentication:** `context.locals.user` is required; the route verifies the
  session itself (it does not rely solely on middleware — `/api/me` is not in
  `PROTECTED_ROUTES`).
- **Authorization:** data is restricted to `id/user_id = auth.uid()` via RLS and
  explicit `.eq(...)` filters. `userId` comes only from the session.
- **No CSRF:** read-only GET with no side effects — no `Origin` check required.
- **Data minimization:** only the fields defined in `ProfileDto`/`ProfileStatsDto`
  are returned; raw columns and internal fields are not exposed.
- **No sensitive logging:** log only the error object in `console.error`, never
  the profile contents.

## 7. Error Handling

| Scenario                | Code | `error.code`           | Action                                                          |
| ----------------------- | ---- | ---------------------- | --------------------------------------------------------------- |
| No session              | 401  | `AUTH_REQUIRED`        | Return immediately in the route.                                |
| Supabase not configured | 500  | `CONFIG_ERROR`         | `createClient` returns `null`.                                  |
| Profile row missing     | 404  | `PROFILE_NOT_FOUND`    | Service throws `ProfileServiceError`.                           |
| Database query error    | 500  | `PROFILE_FETCH_FAILED` | Service throws `ProfileServiceError`; route logs `error.cause`. |
| Unexpected exception    | 500  | `PROFILE_FETCH_FAILED` | Final `catch` in the route.                                     |

There is no dedicated error table in the schema — technical errors are logged
only via `console.error` (consistent with the existing pattern in
[src/pages/api/decks.ts](src/pages/api/decks.ts)).

## 8. Performance Considerations

- **Parallel queries:** run the five queries (1 select + 4 counts) via
  `Promise.all` to minimize total latency (one timing round-trip instead of five
  sequential ones).
- **Count without row transfer:** use
  `select("id", { count: "exact", head: true })` for all counters — only the
  count is transferred, not the rows.
- **Database indexes (already recommended in [.ai/db.md](.ai/db.md)):**
  `decks(user_id, ...)`, `flashcards(user_id, due_at)`,
  `flashcards(user_id, created_by_ai)` support the counters.
- **No pagination** — the response has a fixed, small size.
- **Optional future optimization:** replace the four count queries with a single
  aggregating RPC/SQL function if the counters become a bottleneck.

## 9. Implementation Steps

1. **Create the service** `src/lib/services/profile.service.ts`:
   - Define `ProfileServiceErrorCode` and the `ProfileServiceError` class
     (mirroring [src/lib/services/deck.service.ts](src/lib/services/deck.service.ts)).
   - Import `DECK_LIMIT` from `deck.service.ts` (or declare it locally) for
     `stats.deckLimit`.
   - Implement `mapProfileRow(row: UsersProfileRow): ProfileDto` computing
     `aiCreditsRemaining`.
   - Implement `getProfile(supabase, userId): Promise<GetProfileResponseDto>`:
     - Run the profile select + 4 count queries in parallel (`Promise.all`).
     - If the profile is `null` → throw `ProfileServiceError("PROFILE_NOT_FOUND", ...)`.
     - If any query returns an `error` → throw
       `ProfileServiceError("PROFILE_FETCH_FAILED", ..., { cause })`.
     - Build and return `{ profile, stats }`.
2. **Create the route** `src/pages/api/me.ts`:
   - `export const prerender = false;`
   - `export const GET: APIRoute` with steps: auth → Supabase client → service
     call → error mapping → `jsonOk(result, 200)`.
   - Map `ProfileServiceError.code` to statuses: `PROFILE_NOT_FOUND` → 404, others → 500.
   - Use the `jsonOk` / `jsonError` helpers from
     [src/lib/api/responses.ts](src/lib/api/responses.ts).
3. **Unit tests** `src/lib/services/profile.service.test.ts` (mirroring
   [src/lib/services/deck.service.test.ts](src/lib/services/deck.service.test.ts)):
   - Success: correct mapping and counters, computed `aiCreditsRemaining`.
   - Missing profile → `ProfileServiceError("PROFILE_NOT_FOUND")`.
   - Query error → `ProfileServiceError("PROFILE_FETCH_FAILED")`.
4. **Route tests** `src/pages/api/me.test.ts` (mirroring
   [src/pages/api/decks.test.ts](src/pages/api/decks.test.ts)):
   - 401 without session, 500 on missing configuration, 404 for missing profile,
     200 for success.
5. **Quality verification:** run `npm run lint` and `npm run build`, fix any
   type/lint issues.
6. **(Optional)** add a collection entry in
   [insomnia/decks-api.json](insomnia/decks-api.json) if the team maintains a
   request collection.
