# API Endpoint Implementation Plan: GET /api/ai/generation-logs

## 1. Endpoint Overview

Returns a cursor-paginated list of successful AI generation events for the
authenticated user. Used by analytics views and the dashboard history panel to
surface acceptance-rate metrics without storing source text or prompts.

Key business rules:

- Only rows where `user_id = auth.uid()` are returned (RLS + explicit filter).
- `acceptanceRate` is computed as `saved_cards_count / proposed_cards_count`
  (0 when `proposed_cards_count = 0`).
- Cursor pagination on `(created_at, id)` — default order is `desc`.
- Optional filters: `deckId`, `from` (inclusive date), `to` (inclusive date).
- Only one sort field: `createdAt` (the only meaningful sort for this list).

## 2. Request Details

- **HTTP Method:** `GET`
- **URL:** `/api/ai/generation-logs`
- **Headers:** Supabase session cookies (required)
- **Query parameters:**
  - `limit` optional integer, default `20`, max `100`.
  - `cursor` optional opaque string from the previous page.
  - `deckId` optional UUID.
  - `from` optional `YYYY-MM-DD`, inclusive lower bound on `created_at`.
  - `to` optional `YYYY-MM-DD`, inclusive upper bound on `created_at`.
  - `sort` optional enum `"createdAt"`, default `"createdAt"`.
  - `order` optional `"asc" | "desc"`, default `"desc"`.
- **Request body:** none

## 3. Types Used

All types already present in [src/types.ts](src/types.ts):

- `AiGenerationLogRow` — source DB row.
- `AiGenerationLogListItemDto` — `GenerationLogDto` + computed `acceptanceRate`.
- `ListGenerationLogsResponseDto` — `{ data, pagination }`.
- `ListGenerationLogsQuery` — validated query shape.
- `PaginationDto` — `{ nextCursor, hasMore }`.
- `ApiErrorDto` — consistent error envelope.

New validation type in `src/lib/validation/ai.ts`:

- `listGenerationLogsQuerySchema` (Zod) — coerces and validates all query params.
- `ListGenerationLogsInput` — inferred type.

New service in `src/lib/services/ai.service.ts`:

- `AiServiceErrorCode = "AI_LIST_FAILED" | "INVALID_QUERY"`.
- `class AiServiceError extends Error`.
- `listGenerationLogs(supabase, userId, query)`.

## 4. Response Details

**Success — 200 OK:**

```json
{
  "data": [
    {
      "id": "uuid",
      "deckId": "uuid",
      "proposedCardsCount": 12,
      "savedCardsCount": 9,
      "acceptanceRate": 0.75,
      "model": "openai/gpt-4o-mini",
      "createdAt": "2026-06-11T10:00:00.000Z"
    }
  ],
  "pagination": { "nextCursor": "opaque-or-null", "hasMore": false }
}
```

**Status codes:**

- `200 OK` — list returned (may be empty).
- `400 Bad Request` — `INVALID_QUERY`, invalid cursor / date / deckId / limit.
- `401 Unauthorized` — `AUTH_REQUIRED`.
- `500 Internal Server Error` — `CONFIG_ERROR` or `AI_LIST_FAILED`.

## 5. Data Flow

1. Route: auth guard → Supabase client guard.
2. Parse query string with `listGenerationLogsQuerySchema` → 400 on failure.
3. Call `listGenerationLogs(supabase, userId, query)`.
4. Service builds query on `ai_generation_logs` with `user_id = userId`.
5. Applies optional `deck_id`, `from` (`created_at >= from`), `to` (`created_at <= to + "T23:59:59"`) filters.
6. Decodes cursor if present → keyset `(created_at, id)` predicate.
7. Fetches `limit + 1` rows, maps to DTOs with computed `acceptanceRate`.
8. Route returns `200 ListGenerationLogsResponseDto`.

## 6. Cursor Pagination

Cursor encodes `{ order, value: created_at, id }` as base64-JSON (same
convention as `deck.service.ts`). Invalid/mismatched cursors throw
`AiServiceError("INVALID_QUERY")` → route returns `400`.

## 7. Security

- Auth: session-only `userId`, RLS + explicit `.eq("user_id", userId)`.
- No CSRF check (read-only GET).
- Optional `deckId` filter is scoped to the user — the user cannot enumerate
  other users' logs by providing arbitrary deck IDs.

## 8. Error Handling

| Scenario                | Code | `error.code`    |
| ----------------------- | ---- | --------------- |
| No session              | 401  | `AUTH_REQUIRED` |
| Supabase not configured | 500  | `CONFIG_ERROR`  |
| Bad query param/cursor  | 400  | `INVALID_QUERY` |
| DB query failure        | 500  | `AI_LIST_FAILED`|

## 9. Frontend

A React island `AiGenerationHistory.tsx` displayed on the dashboard below
`ProfileStats`. Fetches the first page (`limit=5`) on mount, shows a compact
table with date, model, proposed/saved counts, and acceptance rate bar.
Includes a "Load more" button for subsequent pages.

## 10. Files Affected

| File | Change |
|---|---|
| `src/lib/validation/ai.ts` | Add `listGenerationLogsQuerySchema` |
| `src/lib/services/ai.service.ts` | New file — `listGenerationLogs` |
| `src/pages/api/ai/generation-logs.ts` | New route |
| `src/components/AiGenerationHistory.tsx` | New React island |
| `src/pages/dashboard.astro` | Mount `AiGenerationHistory` island |
