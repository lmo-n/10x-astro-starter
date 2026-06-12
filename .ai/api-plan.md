# REST API Plan

## 1. Resources

- **Profile** -> `public.users_profiles`
  - Represents the authenticated user's application profile, plan, and AI credit counters.
- **Decks** -> `public.decks`
  - User-owned flashcard collections. Each deck belongs to exactly one authenticated user.
- **Flashcards** -> `public.flashcards`
  - User-owned study cards stored inside decks. Cards can be created manually or approved from AI proposals.
- **AI Generation Logs** -> `public.ai_generation_logs`
  - Append-only metadata for successful AI generation approval flows. It stores counts and model metadata, not source text or prompts.
- **Study Reviews** -> `public.flashcards` SM-2 scheduling fields
  - A business resource exposed through study endpoints. Review actions update `sm2_interval`, `sm2_repetition`, `sm2_ease_factor`, `due_at`, and `last_reviewed_at`.
- **Authentication Session** -> Supabase Auth
  - Google OAuth login and sign-out are handled by Supabase Auth, with Astro API routes used only where the app needs route-level control.

### API design assumptions

- The API is implemented as Astro server endpoints under `src/pages/api/**` and runs on Cloudflare Workers.
- Supabase is the system of record for authentication, row-level authorization, and transactional database operations.
- The browser calls the selected AI provider directly for proposal generation, as specified in the tech stack. The app API validates and persists only the user's approved cards.
- AI provider API keys must not be exposed as unrestricted secrets in browser code. If direct browser calls are required, use a provider-supported ephemeral token, restricted key, or a Cloudflare-bound token exchange. If that is unavailable, introduce a thin server-side AI proposal endpoint as a security revision.
- The free monthly AI credit limit is not finalized in the database plan. API responses should expose the configured value from `users_profiles.ai_credits_limit` without hard-coding it in the client.
- Pagination uses cursor-based pagination for all list endpoints that can grow over time.
- All timestamps returned by the API are ISO 8601 strings. Date-only fields use `YYYY-MM-DD`.
- Error responses use a consistent envelope:

```json
{
  "error": {
    "code": "string",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## 2. Endpoints

### 2.1 Authentication Session

#### Start Google OAuth

- **Method:** `GET`
- **Path:** `/api/auth/google`
- **Description:** Starts Supabase Google OAuth login and redirects the user to the provider.
- **Query parameters:**
  - `redirectTo` optional string. Relative path to return to after successful authentication. Defaults to `/dashboard`.
- **Request body:** None.
- **Success response:** HTTP redirect to the Google OAuth consent flow.
- **Success codes:**
  - `302 Found` -> Redirect started.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_REDIRECT`, redirect path is not allowed.
  - `500 Internal Server Error` -> `OAUTH_START_FAILED`, Supabase OAuth initialization failed.

#### Sign Out

- **Method:** `POST`
- **Path:** `/api/auth/signout`
- **Description:** Signs out the current user and clears the Supabase session cookies.
- **Request body:** None.
- **Response body:**

```json
{
  "message": "Signed out successfully"
}
```

- **Success codes:**
  - `200 OK` -> Session ended.
- **Error codes:**
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `500 Internal Server Error` -> `SIGNOUT_FAILED`, Supabase sign-out failed.

### 2.2 Profile

#### Get Current Profile

- **Method:** `GET`
- **Path:** `/api/me`
- **Description:** Returns the authenticated user's profile, plan, AI credits, and useful dashboard counters.
- **Request body:** None.
- **Response body:**

```json
{
  "profile": {
    "id": "uuid",
    "planType": "free",
    "aiCreditsLimit": 100,
    "aiCreditsUsed": 25,
    "aiCreditsRemaining": 75,
    "aiCreditsResetDate": "2026-07-11",
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:00:00.000Z"
  },
  "stats": {
    "deckCount": 12,
    "deckLimit": 120,
    "dueFlashcardsCount": 34,
    "totalFlashcardsCount": 420,
    "aiCreatedFlashcardsCount": 315
  }
}
```

- **Success codes:**
  - `200 OK` -> Profile returned.
- **Error codes:**
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `PROFILE_NOT_FOUND`, profile trigger did not create a row.

#### Get AI Credit Status

- **Method:** `GET`
- **Path:** `/api/me/ai-credits`
- **Description:** Returns AI credit status for the generation UI in user-friendly terms.
- **Request body:** None.
- **Response body:**

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

- **Success codes:**
  - `200 OK` -> Credit status returned.
- **Error codes:**
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `PROFILE_NOT_FOUND`, profile row is missing.

### 2.3 Decks

#### List Decks

- **Method:** `GET`
- **Path:** `/api/decks`
- **Description:** Lists decks owned by the authenticated user.
- **Query parameters:**
  - `limit` optional integer, default `20`, maximum `100`.
  - `cursor` optional string returned from the previous page.
  - `sort` optional enum: `createdAt`, `updatedAt`, `name`. Default `updatedAt`.
  - `order` optional enum: `asc`, `desc`. Default `desc`.
  - `search` optional string. Case-insensitive deck name search.
- **Request body:** None.
- **Response body:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Biology 101",
      "createdAt": "2026-06-11T10:00:00.000Z",
      "updatedAt": "2026-06-11T10:00:00.000Z",
      "flashcardsCount": 42,
      "dueFlashcardsCount": 8
    }
  ],
  "pagination": {
    "nextCursor": "opaque-cursor-or-null",
    "hasMore": true
  },
  "limits": {
    "deckCount": 12,
    "deckLimit": 120,
    "canCreateDeck": true
  }
}
```

- **Success codes:**
  - `200 OK` -> Deck list returned.
- **Error codes:**
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `400 Bad Request` -> `INVALID_QUERY`, unsupported sort, order, cursor, or limit.

#### Create Deck

- **Method:** `POST`
- **Path:** `/api/decks`
- **Description:** Creates a new deck for the authenticated user.
- **Request body:**

```json
{
  "name": "Biology 101"
}
```

- **Response body:**

```json
{
  "deck": {
    "id": "uuid",
    "name": "Biology 101",
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:00:00.000Z",
    "flashcardsCount": 0,
    "dueFlashcardsCount": 0
  },
  "limits": {
    "deckCount": 13,
    "deckLimit": 120,
    "canCreateDeck": true
  }
}
```

- **Success codes:**
  - `201 Created` -> Deck created.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_NAME`, name is empty after trimming.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `409 Conflict` -> `DECK_LIMIT_REACHED`, user already has 120 decks.
  - `500 Internal Server Error` -> `DECK_CREATE_FAILED`, unexpected persistence failure.

#### Get Deck

- **Method:** `GET`
- **Path:** `/api/decks/{deckId}`
- **Description:** Returns a single deck owned by the authenticated user.
- **Path parameters:**
  - `deckId` UUID.
- **Request body:** None.
- **Response body:**

```json
{
  "deck": {
    "id": "uuid",
    "name": "Biology 101",
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:00:00.000Z",
    "flashcardsCount": 42,
    "dueFlashcardsCount": 8
  }
}
```

- **Success codes:**
  - `200 OK` -> Deck returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, path parameter is not a UUID.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.

#### Rename Deck

- **Method:** `PATCH`
- **Path:** `/api/decks/{deckId}`
- **Description:** Updates a deck name. Deck names are not required to be unique per user.
- **Path parameters:**
  - `deckId` UUID.
- **Request body:**

```json
{
  "name": "Biology Final Exam"
}
```

- **Response body:**

```json
{
  "deck": {
    "id": "uuid",
    "name": "Biology Final Exam",
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:05:00.000Z",
    "flashcardsCount": 42,
    "dueFlashcardsCount": 8
  }
}
```

- **Success codes:**
  - `200 OK` -> Deck renamed.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, path parameter is not a UUID.
  - `400 Bad Request` -> `INVALID_DECK_NAME`, name is empty after trimming.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.

#### Delete Deck

- **Method:** `DELETE`
- **Path:** `/api/decks/{deckId}`
- **Description:** Deletes a deck and all of its flashcards. Physical deletion is used for MVP.
- **Path parameters:**
  - `deckId` UUID.
- **Request body:** None.
- **Response body:**

```json
{
  "message": "Deck deleted successfully"
}
```

- **Success codes:**
  - `200 OK` -> Deck deleted.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, path parameter is not a UUID.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.

### 2.4 Flashcards

#### List Flashcards In Deck

- **Method:** `GET`
- **Path:** `/api/decks/{deckId}/flashcards`
- **Description:** Lists flashcards inside one user-owned deck.
- **Path parameters:**
  - `deckId` UUID.
- **Query parameters:**
  - `limit` optional integer, default `20`, maximum `100`.
  - `cursor` optional string returned from the previous page.
  - `sort` optional enum: `createdAt`, `updatedAt`, `dueAt`. Default `createdAt`.
  - `order` optional enum: `asc`, `desc`. Default `desc`.
  - `createdByAi` optional boolean.
  - `due` optional enum: `all`, `due`, `future`. Default `all`.
  - `search` optional string. Searches front and back text.
- **Request body:** None.
- **Response body:**

```json
{
  "data": [
    {
      "id": "uuid",
      "deckId": "uuid",
      "frontText": "What is photosynthesis?",
      "backText": "Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose.",
      "createdByAi": false,
      "sm2": {
        "interval": 0,
        "repetition": 0,
        "easeFactor": 2.5,
        "dueAt": "2026-06-11",
        "lastReviewedAt": null
      },
      "createdAt": "2026-06-11T10:00:00.000Z",
      "updatedAt": "2026-06-11T10:00:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": "opaque-cursor-or-null",
    "hasMore": true
  }
}
```

- **Success codes:**
  - `200 OK` -> Flashcard list returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, path parameter is not a UUID.
  - `400 Bad Request` -> `INVALID_QUERY`, unsupported filter, sort, order, cursor, or limit.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.

#### Create Manual Flashcard

- **Method:** `POST`
- **Path:** `/api/decks/{deckId}/flashcards`
- **Description:** Creates a manual flashcard in a user-owned deck with `created_by_ai = false`.
- **Path parameters:**
  - `deckId` UUID.
- **Request body:**

```json
{
  "frontText": "What is photosynthesis?",
  "backText": "Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose."
}
```

- **Response body:**

```json
{
  "flashcard": {
    "id": "uuid",
    "deckId": "uuid",
    "frontText": "What is photosynthesis?",
    "backText": "Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose.",
    "createdByAi": false,
    "sm2": {
      "interval": 0,
      "repetition": 0,
      "easeFactor": 2.5,
      "dueAt": "2026-06-11",
      "lastReviewedAt": null
    },
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:00:00.000Z"
  }
}
```

- **Success codes:**
  - `201 Created` -> Flashcard created.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, path parameter is not a UUID.
  - `400 Bad Request` -> `INVALID_FLASHCARD_TEXT`, front or back text is empty, too long, not plain text, or front text exceeds the short-question rule.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.

#### Get Flashcard

- **Method:** `GET`
- **Path:** `/api/flashcards/{flashcardId}`
- **Description:** Returns one flashcard owned by the authenticated user.
- **Path parameters:**
  - `flashcardId` UUID.
- **Request body:** None.
- **Response body:**

```json
{
  "flashcard": {
    "id": "uuid",
    "deckId": "uuid",
    "frontText": "What is photosynthesis?",
    "backText": "Photosynthesis is the process by which plants convert light energy into chemical energy stored in glucose.",
    "createdByAi": false,
    "sm2": {
      "interval": 0,
      "repetition": 0,
      "easeFactor": 2.5,
      "dueAt": "2026-06-11",
      "lastReviewedAt": null
    },
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:00:00.000Z"
  }
}
```

- **Success codes:**
  - `200 OK` -> Flashcard returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_FLASHCARD_ID`, path parameter is not a UUID.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `FLASHCARD_NOT_FOUND`, flashcard does not exist or is not owned by the user.

#### Update Flashcard Text

- **Method:** `PATCH`
- **Path:** `/api/flashcards/{flashcardId}`
- **Description:** Updates `front_text` and/or `back_text` without resetting SM-2 progress. Moving a card to another deck is not allowed for MVP.
- **Path parameters:**
  - `flashcardId` UUID.
- **Request body:**

```json
{
  "frontText": "What does photosynthesis produce?",
  "backText": "Photosynthesis produces glucose and oxygen from carbon dioxide, water, and light energy."
}
```

- **Response body:**

```json
{
  "flashcard": {
    "id": "uuid",
    "deckId": "uuid",
    "frontText": "What does photosynthesis produce?",
    "backText": "Photosynthesis produces glucose and oxygen from carbon dioxide, water, and light energy.",
    "createdByAi": false,
    "sm2": {
      "interval": 12,
      "repetition": 4,
      "easeFactor": 2.6,
      "dueAt": "2026-06-20",
      "lastReviewedAt": "2026-06-08"
    },
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T11:00:00.000Z"
  }
}
```

- **Success codes:**
  - `200 OK` -> Flashcard updated.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_FLASHCARD_ID`, path parameter is not a UUID.
  - `400 Bad Request` -> `INVALID_FLASHCARD_TEXT`, provided text is empty, too long, not plain text, or front text exceeds the short-question rule.
  - `400 Bad Request` -> `IMMUTABLE_FLASHCARD_FIELDS`, request attempts to update `deckId`, `createdByAi`, or SM-2 fields through this endpoint.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `FLASHCARD_NOT_FOUND`, flashcard does not exist or is not owned by the user.

#### Delete Flashcard

- **Method:** `DELETE`
- **Path:** `/api/flashcards/{flashcardId}`
- **Description:** Physically deletes one flashcard owned by the authenticated user.
- **Path parameters:**
  - `flashcardId` UUID.
- **Request body:** None.
- **Response body:**

```json
{
  "message": "Flashcard deleted successfully"
}
```

- **Success codes:**
  - `200 OK` -> Flashcard deleted.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_FLASHCARD_ID`, path parameter is not a UUID.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `FLASHCARD_NOT_FOUND`, flashcard does not exist or is not owned by the user.

### 2.5 AI Flashcard Workflow

#### Generate AI Flashcard Proposals

- **Method:** Not an application REST endpoint in the MVP.
- **Path:** Browser-to-provider API call.
- **Description:** The frontend sends source text and optional instructions directly to the selected AI provider and receives proposed flashcards. The source text, prompt, detected language, AI errors, and rejected proposals are not persisted by the application database.
- **Client-side request contract:**

```json
{
  "sourceText": "string between 5000 and 10000 characters",
  "instructions": "optional short instruction",
  "language": "pl | en | auto",
  "model": "gpt-4o-mini | claude-3-haiku"
}
```

- **Client-side proposal shape:**

```json
{
  "cards": [
    {
      "frontText": "Short question or prompt",
      "backText": "Plain-text answer"
    }
  ],
  "model": "gpt-4o-mini"
}
```

- **Client-side validation before provider call:**
  - `sourceText` must be 5,000 to 10,000 characters after trimming.
  - `instructions` is optional and should be capped at 500 characters.
  - UI must show a loading animation during the provider call.
  - UI must show a friendly error, a retry action, and a manual-entry CTA for timeout, content filter, or provider errors.
- **Security note:** Direct browser AI calls require a restricted or ephemeral credential strategy. If unavailable, replace this contract with `POST /api/ai/flashcards/proposals` implemented on Cloudflare Workers.

#### Approve AI Generated Flashcards

- **Method:** `POST`
- **Path:** `/api/ai/flashcards/approve`
- **Description:** Transactionally saves selected AI-generated cards, increments AI credits using the proposed card count, and writes one `ai_generation_logs` row. This endpoint should call the `approve_ai_generated_flashcards(...)` database function or equivalent transaction.
- **Request body:**

```json
{
  "deckId": "uuid",
  "proposedCardsCount": 12,
  "model": "gpt-4o-mini",
  "cards": [
    {
      "frontText": "What is osmosis?",
      "backText": "Osmosis is the movement of water through a semipermeable membrane from lower solute concentration to higher solute concentration."
    }
  ]
}
```

- **Response body:**

```json
{
  "savedCards": [
    {
      "id": "uuid",
      "deckId": "uuid",
      "frontText": "What is osmosis?",
      "backText": "Osmosis is the movement of water through a semipermeable membrane from lower solute concentration to higher solute concentration.",
      "createdByAi": true,
      "sm2": {
        "interval": 0,
        "repetition": 0,
        "easeFactor": 2.5,
        "dueAt": "2026-06-11",
        "lastReviewedAt": null
      },
      "createdAt": "2026-06-11T10:00:00.000Z",
      "updatedAt": "2026-06-11T10:00:00.000Z"
    }
  ],
  "generationLog": {
    "id": "uuid",
    "deckId": "uuid",
    "proposedCardsCount": 12,
    "savedCardsCount": 1,
    "model": "gpt-4o-mini",
    "createdAt": "2026-06-11T10:00:00.000Z"
  },
  "aiCredits": {
    "limit": 100,
    "used": 37,
    "remaining": 63,
    "resetDate": "2026-07-11"
  }
}
```

- **Success codes:**
  - `201 Created` -> Selected cards saved and generation log written.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_DECK_ID`, deck ID is not a UUID.
  - `400 Bad Request` -> `INVALID_GENERATION_COUNTS`, proposed count is negative, saved count exceeds proposed count, or card list is inconsistent.
  - `400 Bad Request` -> `INVALID_FLASHCARD_TEXT`, one or more selected cards violate text constraints.
  - `400 Bad Request` -> `INVALID_MODEL`, model is not supported.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `402 Payment Required` -> `AI_CREDITS_EXHAUSTED`, proposed card count exceeds remaining credits.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck does not exist or is not owned by the user.
  - `409 Conflict` -> `AI_CREDITS_CHANGED`, credits changed since preview and the request can no longer be applied.

#### List AI Generation Logs

- **Method:** `GET`
- **Path:** `/api/ai/generation-logs`
- **Description:** Lists successful generation metadata for the authenticated user. This can support analytics views and debugging of acceptance-rate metrics without storing source text.
- **Query parameters:**
  - `limit` optional integer, default `20`, maximum `100`.
  - `cursor` optional string returned from the previous page.
  - `deckId` optional UUID.
  - `from` optional date, inclusive.
  - `to` optional date, inclusive.
  - `sort` optional enum: `createdAt`. Default `createdAt`.
  - `order` optional enum: `asc`, `desc`. Default `desc`.
- **Request body:** None.
- **Response body:**

```json
{
  "data": [
    {
      "id": "uuid",
      "deckId": "uuid",
      "proposedCardsCount": 12,
      "savedCardsCount": 9,
      "acceptanceRate": 0.75,
      "model": "gpt-4o-mini",
      "createdAt": "2026-06-11T10:00:00.000Z"
    }
  ],
  "pagination": {
    "nextCursor": "opaque-cursor-or-null",
    "hasMore": true
  }
}
```

- **Success codes:**
  - `200 OK` -> Logs returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_QUERY`, unsupported date range, cursor, deck ID, limit, sort, or order.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.

### 2.6 Study Mode

#### Get Due Study Queue

- **Method:** `GET`
- **Path:** `/api/study/due`
- **Description:** Returns due flashcards for the authenticated user, optionally scoped to one deck. Uses `flashcards(user_id, due_at)` and optionally `flashcards(deck_id, due_at)` indexes.
- **Query parameters:**
  - `deckId` optional UUID.
  - `limit` optional integer, default `20`, maximum `100`.
  - `cursor` optional string returned from the previous page.
  - `includeFuturePreview` optional boolean, default `false`. If true, includes a small count of upcoming cards but does not return full future card content.
- **Request body:** None.
- **Response body:**

```json
{
  "data": [
    {
      "id": "uuid",
      "deckId": "uuid",
      "frontText": "What is osmosis?",
      "backText": "Osmosis is the movement of water through a semipermeable membrane from lower solute concentration to higher solute concentration.",
      "sm2": {
        "interval": 0,
        "repetition": 0,
        "easeFactor": 2.5,
        "dueAt": "2026-06-11",
        "lastReviewedAt": null
      }
    }
  ],
  "pagination": {
    "nextCursor": "opaque-cursor-or-null",
    "hasMore": true
  },
  "summary": {
    "dueCount": 34,
    "suggestedTodayCount": 25,
    "upcomingCount": 18
  }
}
```

- **Success codes:**
  - `200 OK` -> Due queue returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_QUERY`, invalid deck ID, cursor, or limit.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck filter does not belong to the user.

#### Submit Study Review

- **Method:** `POST`
- **Path:** `/api/study/reviews`
- **Description:** Applies the SM-2 algorithm to one reviewed flashcard. The server computes scheduling fields to prevent client-side tampering.
- **Request body:**

```json
{
  "flashcardId": "uuid",
  "grade": "good"
}
```

- **Allowed grades:**
  - `again` -> failed recall, maps to low SM-2 quality.
  - `hard` -> difficult recall.
  - `good` -> successful recall.
  - `easy` -> easy recall.
- **Response body:**

```json
{
  "flashcard": {
    "id": "uuid",
    "deckId": "uuid",
    "frontText": "What is osmosis?",
    "backText": "Osmosis is the movement of water through a semipermeable membrane from lower solute concentration to higher solute concentration.",
    "createdByAi": true,
    "sm2": {
      "interval": 1,
      "repetition": 1,
      "easeFactor": 2.5,
      "dueAt": "2026-06-12",
      "lastReviewedAt": "2026-06-11"
    },
    "createdAt": "2026-06-11T10:00:00.000Z",
    "updatedAt": "2026-06-11T10:15:00.000Z"
  },
  "nextDueCount": 33
}
```

- **Success codes:**
  - `200 OK` -> Review recorded and schedule updated.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_FLASHCARD_ID`, flashcard ID is not a UUID.
  - `400 Bad Request` -> `INVALID_REVIEW_GRADE`, grade is not one of `again`, `hard`, `good`, or `easy`.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `FLASHCARD_NOT_FOUND`, flashcard does not exist or is not owned by the user.
  - `409 Conflict` -> `REVIEW_CONFLICT`, card scheduling state changed between loading and submission if optimistic concurrency is used.

### 2.7 Analytics Summary

#### Get User Analytics Summary

- **Method:** `GET`
- **Path:** `/api/analytics/summary`
- **Description:** Returns MVP success metric summaries for the authenticated user. For product-wide analytics, use admin-only infrastructure outside the user API.
- **Query parameters:**
  - `from` optional date, inclusive.
  - `to` optional date, inclusive.
  - `deckId` optional UUID.
- **Request body:** None.
- **Response body:**

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

- **Success codes:**
  - `200 OK` -> Analytics summary returned.
- **Error codes:**
  - `400 Bad Request` -> `INVALID_QUERY`, invalid date range or deck ID.
  - `401 Unauthorized` -> `AUTH_REQUIRED`, no active session.
  - `404 Not Found` -> `DECK_NOT_FOUND`, deck filter does not belong to the user.

## 3. Authentication and Authorization

### Authentication mechanism

- Use Supabase Auth with Google OAuth as the only registration and login method for MVP.
- Astro SSR endpoints create a Supabase SSR client through `@supabase/ssr` and read the authenticated session from cookies.
- API routes must reject unauthenticated requests with `401 Unauthorized` and `AUTH_REQUIRED`.
- The `handle_new_user()` database trigger creates the matching `public.users_profiles` row after a new `auth.users` row is created.

### Authorization model

- Enable PostgreSQL RLS on all domain tables: `users_profiles`, `decks`, `flashcards`, and `ai_generation_logs`.
- Every API route must use the authenticated Supabase user ID as the authorization boundary.
- The API must never accept `userId` from the client for domain writes.
- `users_profiles` access is limited to `id = auth.uid()`.
- `decks` access is limited to `user_id = auth.uid()`.
- `flashcards` access is limited to `user_id = auth.uid()`. On insert, `user_id` is derived from the deck owner by trigger or RPC.
- `ai_generation_logs` reads are limited to `user_id = auth.uid()`. Inserts should happen only through the AI approval transaction.
- Direct user updates to sensitive profile fields are disallowed: `plan_type`, `ai_credits_limit`, `ai_credits_used`, and `ai_credits_reset_date` should be controlled by database functions or trusted service code.

### Security controls

- Validate all request bodies with Zod in API routes before calling Supabase.
- Use parameterized Supabase queries or RPC calls only. Do not construct SQL strings from request input.
- Enforce CSRF protection for cookie-authenticated mutation endpoints. At minimum, require same-origin requests and validate `Origin`/`Referer`; for higher assurance, add a CSRF token for POST, PATCH, and DELETE routes.
- Rate-limit mutation endpoints by authenticated user and IP at the Cloudflare layer:
  - Deck and manual flashcard mutations: moderate per-minute limits.
  - AI approval endpoint: stricter per-minute limits plus DB credit checks.
  - Study reviews: generous but bounded limits to prevent accidental loops.
- Do not log source text, AI instructions, AI provider responses, rejected cards, or AI error details in persistent application logs.
- Escape rendered flashcard content in the UI and store flashcards as plain text only.
- Return `404 Not Found` instead of `403 Forbidden` for user-owned resources that do not belong to the requester to avoid resource enumeration.
- Use Cloudflare request body limits and app-level JSON size limits. The AI approval endpoint should reject unusually large payloads even though source text is not sent there.

## 4. Validation and Business Logic

### Shared validation rules

- All IDs in paths and request bodies must be valid UUIDs.
- Unknown JSON fields should be rejected on mutation endpoints to prevent accidental writes to protected fields.
- String inputs must be trimmed before validation and persistence.
- Empty strings after trimming are invalid.
- All list endpoints must cap `limit` at `100`.
- Cursors must be opaque, signed or encoded server-side, and scoped to the authenticated user and active query shape.

### Profile validation and logic

- `plan_type` must be `free` for MVP.
- `ai_credits_limit >= 0`.
- `ai_credits_used >= 0`.
- `ai_credits_used <= ai_credits_limit`.
- `ai_credits_reset_date` is required.
- Profile creation is automatic via `handle_new_user()` and not exposed as a public create endpoint.
- AI credits reset monthly based on the user's account creation date or the chosen monthly reset rule.
- The API exposes user-friendly credit messages and must avoid technical language such as API tokens.

### Deck validation and logic

- `name` is required.
- `length(trim(name)) > 0`.
- Deck names are not unique per user.
- Each user can own at most 120 decks.
- The 120-deck limit is enforced in the database by `enforce_deck_limit()` and surfaced by `POST /api/decks` as `409 DECK_LIMIT_REACHED`.
- Deleting a deck physically deletes its flashcards through cascading delete.
- Deck list sorting should use the recommended indexes:
  - `decks(user_id, created_at)` for creation-order lists.
  - `decks(user_id, updated_at)` for dashboard recency lists.

### Flashcard validation and logic

- `frontText` is required and maps to `front_text`.
- `backText` is required and maps to `back_text`.
- `length(trim(front_text)) > 0`.
- `length(trim(back_text)) > 0`.
- `char_length(front_text) <= 500`.
- `char_length(back_text) <= 3000`.
- Front text should be short, approximately two sentences. The API should enforce this with a conservative heuristic, such as rejecting more than two sentence-ending punctuation marks unless product testing requires a softer rule.
- Text is plain text only. Reject or sanitize HTML-like input and always render escaped text in the UI.
- Manual creation sets `created_by_ai = false` server-side.
- AI approval creation sets `created_by_ai = true` server-side.
- The client must not provide `userId`, `createdByAi`, or SM-2 fields for manual creation.
- `user_id` must match the owner of `deck_id`; this is enforced by `set_flashcard_user_id_from_deck()` or an insert RPC.
- Moving flashcards between decks is out of scope. `deckId` is immutable through `PATCH /api/flashcards/{flashcardId}`.
- Updating `frontText` or `backText` must not reset `sm2_interval`, `sm2_repetition`, `sm2_ease_factor`, `due_at`, or `last_reviewed_at`.
- Flashcard list and study queries should use the recommended indexes:
  - `flashcards(deck_id, created_at)` for deck card lists.
  - `flashcards(user_id, due_at)` for study queues.
  - `flashcards(user_id, created_by_ai)` for adoption-rate analytics.

### AI generation validation and logic

- Source text generation input is validated client-side before direct provider calls:
  - Minimum 5,000 characters.
  - Maximum 10,000 characters.
  - Polish and English are supported.
- Optional instructions are appended to the model prompt but are not persisted.
- The application database must never store pasted source text.
- The application database must never store custom user instructions, detected language, AI errors, timeout details, content filter details, or rejected proposals.
- Successful approval is transactional:
  - Verify the authenticated user owns `deckId`.
  - Validate `proposedCardsCount >= 0`.
  - Validate `cards.length <= proposedCardsCount`.
  - Validate every selected card using flashcard text rules.
  - Validate the user has enough AI credits for `proposedCardsCount`.
  - Insert selected flashcards with `created_by_ai = true`.
  - Increment `users_profiles.ai_credits_used` by `proposedCardsCount`, not by saved card count.
  - Insert one `ai_generation_logs` row.
- `ai_generation_logs.saved_cards_count <= ai_generation_logs.proposed_cards_count`.
- `ai_generation_logs.model` is required and must match an allowed model identifier.
- AI acceptance rate is calculated as `saved_cards_count / proposed_cards_count`, excluding zero-proposed rows from division.
- AI adoption rate is calculated as AI-created flashcards divided by all flashcards.
- Use `ai_generation_logs(user_id, created_at)` for user history and credit-period analytics.
- Use `ai_generation_logs(deck_id, created_at)` for deck-scoped analytics.

### Study review validation and logic

- The study queue returns cards where `due_at <= current_date`, scoped to `auth.uid()` and optionally to a user-owned `deckId`.
- The server owns all SM-2 updates. Clients submit only `flashcardId` and `grade`.
- Supported grades are `again`, `hard`, `good`, and `easy`. A 3-button UI may omit `again`, but the API can still support it for future UX variants.
- The server maps grades to SM-2 quality values consistently. Recommended mapping:
  - `again` -> quality `2`
  - `hard` -> quality `3`
  - `good` -> quality `4`
  - `easy` -> quality `5`
- SM-2 update rules:
  - If quality is below `3`, reset repetition to `0` and schedule the card soon.
  - If quality is at least `3`, increment repetition and compute the next interval according to SM-2.
  - Keep `sm2_ease_factor > 0`; use a practical minimum such as `1.30` even though the schema only requires a positive value.
  - Set `last_reviewed_at = current_date`.
  - Set `due_at = current_date + sm2_interval`.
- Study progress is represented only by current fields on `flashcards`; review history is out of scope for MVP.
- The API may return `suggestedTodayCount` to support exam-focused guidance, but it should not block users from reviewing more cards.

### Error handling rules

- Validation errors return `400 Bad Request` with a field-level `details` object.
- Authentication failures return `401 Unauthorized`.
- Ownership failures for resources return `404 Not Found`.
- Deck limit conflicts return `409 Conflict` with a friendly message suitable for encouraging cleanup of old post-exam decks.
- Exhausted AI credits return `402 Payment Required` with a friendly message and current credit status.
- AI provider timeout, content filter, and provider API failures are handled in the client-side generation UI because provider calls are direct from the frontend in the MVP.
- Server errors return `500 Internal Server Error` with a generic message and no sensitive details.

### Endpoint-to-business-requirement mapping

- Google SSO login -> `GET /api/auth/google`, Supabase OAuth callback handling, `POST /api/auth/signout`.
- Profile creation and AI limit flags -> Supabase Auth trigger `handle_new_user()`, `GET /api/me`, `GET /api/me/ai-credits`.
- Deck create, rename, delete, empty state, and 120-deck limit -> `GET /api/decks`, `POST /api/decks`, `GET /api/decks/{deckId}`, `PATCH /api/decks/{deckId}`, `DELETE /api/decks/{deckId}`.
- Manual flashcard creation and management -> `GET /api/decks/{deckId}/flashcards`, `POST /api/decks/{deckId}/flashcards`, `GET /api/flashcards/{flashcardId}`, `PATCH /api/flashcards/{flashcardId}`, `DELETE /api/flashcards/{flashcardId}`.
- AI proposal generation -> direct browser-to-provider call with client validation and friendly UI error handling.
- AI verification and approval -> `POST /api/ai/flashcards/approve`.
- AI acceptance and adoption metrics -> `GET /api/ai/generation-logs`, `GET /api/analytics/summary`.
- Friendly AI limits UI -> `GET /api/me/ai-credits` and the approval response credit summary.
- Study mode and SM-2 scheduling -> `GET /api/study/due`, `POST /api/study/reviews`.
