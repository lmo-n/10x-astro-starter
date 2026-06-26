# API Endpoint Implementation Plan: GET /api/analytics/summary

## 1. Endpoint Overview

Returns MVP success-metric aggregates for the authenticated user: AI acceptance
rate, AI adoption rate, and the raw counts they are derived from. Optionally
scoped to a date range and/or a single deck.

Key business rules:

- Only rows where `user_id = auth.uid()` are included (RLS + explicit filter).
- `aiAcceptanceRate = savedAiCardsCount / proposedCardsCount` (0 when no logs).
- `aiAdoptionRate = aiCreatedFlashcardsCount / totalFlashcardsCount` (0 when no cards).
- `proposedCardsCount` and `savedAiCardsCount` are summed from `ai_generation_logs`.
- `totalFlashcardsCount` and `aiCreatedFlashcardsCount` are counted from `flashcards`.
- When `deckId` is supplied, both tables are filtered by `deck_id = deckId` and
  the deck must exist and be owned by the user (`404 DECK_NOT_FOUND` otherwise).

## 2. Request Details

- **HTTP Method:** `GET`
- **URL:** `/api/analytics/summary`
- **Headers:** Supabase session cookies (required)
- **Query parameters:**
  - `deckId` optional UUID.
  - `from` optional `YYYY-MM-DD`, inclusive lower bound on `created_at` /
    flashcard `created_at`.
  - `to` optional `YYYY-MM-DD`, inclusive upper bound.
- **Request body:** none

## 3. Types Used

All types already present in [src/types.ts](src/types.ts):

- `AnalyticsSummaryDto` — all aggregate fields.
- `GetAnalyticsSummaryResponseDto` — `{ analytics: AnalyticsSummaryDto }`.
- `GetAnalyticsSummaryQuery` — validated query shape.
- `ApiErrorDto` — consistent error envelope.

New validation type added to `src/lib/validation/ai.ts`:

- `analyticsSummaryQuerySchema` (Zod).
- `AnalyticsSummaryInput` — inferred type.

New service function added to `src/lib/services/ai.service.ts`:

- `getAnalyticsSummary(supabase, userId, query)`.
- New error code `"ANALYTICS_FAILED"` added to `AiServiceErrorCode`.

## 4. Response Details

**Success — 200 OK:**

```json
{
  "analytics": {
    "aiAcceptanceRate": 0.75,
    "aiAdoptionRate": 0.72,
    "proposedCardsCount": 120,
    "savedAiCardsCount": 90,
    "totalFlashcardsCount": 125,
    "aiCreatedFlashcardsCount": 90
  }
}
```

**Status codes:**

- `200 OK` — analytics returned.
- `400 Bad Request` — `INVALID_QUERY`, invalid date or deckId.
- `401 Unauthorized` — `AUTH_REQUIRED`.
- `404 Not Found` — `DECK_NOT_FOUND`, deckId does not belong to the user.
- `500 Internal Server Error` — `CONFIG_ERROR` or `ANALYTICS_FAILED`.

## 5. Data Flow

1. Route: auth guard → Supabase client guard.
2. Parse query string with `analyticsSummaryQuerySchema` → 400 on failure.
3. Call `getAnalyticsSummary(supabase, userId, query)`.
4. If `deckId` provided: verify ownership with a single head-only count on
   `decks` → throw `AiServiceError("DECK_NOT_FOUND")` when count is 0.
5. Run four queries in parallel (`Promise.all`):
   - `ai_generation_logs`: select `proposed_cards_count, saved_cards_count`
     (all rows in scope), then sum in JS.
   - `flashcards` total count: `count: "exact", head: true`.
   - `flashcards` AI count: `count: "exact", head: true`, `created_by_ai = true`.
6. Compute rates and return `GetAnalyticsSummaryResponseDto`.

## 6. Filters Applied

| Filter    | `ai_generation_logs`              | `flashcards`                      |
| --------- | --------------------------------- | --------------------------------- |
| `user_id` | ✅ always                         | ✅ always                         |
| `deckId`  | `deck_id = deckId`                | `deck_id = deckId`                |
| `from`    | `created_at >= from + T00:00:00Z` | `created_at >= from + T00:00:00Z` |
| `to`      | `created_at <= to + T23:59:59Z`   | `created_at <= to + T23:59:59Z`   |

## 7. Security

- Auth: session-only `userId`, RLS + explicit `.eq("user_id", userId)`.
- No CSRF check (read-only GET).
- `deckId` is verified against the user's decks — returns 404 for any deckId
  not owned by the requester (prevents enumeration).

## 8. Error Handling

| Scenario                | Code | `error.code`       |
| ----------------------- | ---- | ------------------ |
| No session              | 401  | `AUTH_REQUIRED`    |
| Supabase not configured | 500  | `CONFIG_ERROR`     |
| Bad query param         | 400  | `INVALID_QUERY`    |
| deckId not owned        | 404  | `DECK_NOT_FOUND`   |
| DB query failure        | 500  | `ANALYTICS_FAILED` |

## 9. Files Affected

| File                                 | Change                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| `src/lib/validation/ai.ts`           | Add `analyticsSummaryQuerySchema`                      |
| `src/lib/services/ai.service.ts`     | Add `getAnalyticsSummary`, extend `AiServiceErrorCode` |
| `src/pages/api/analytics/summary.ts` | New route                                              |
