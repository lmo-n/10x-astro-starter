// =============================================================================
// Shared application types: database entities, DTOs, and Command Models
// =============================================================================
//
// This file is the single source of truth for the data structures exchanged
// between the Astro API routes (`src/pages/api/**`) and clients.
//
// Layering:
//   1. Database entity row types  — mirror the SQL schema in
//      `supabase/migrations/20260611000000_initial_schema.sql` / `.ai/db.md`.
//      (No Supabase-generated `Database` type exists in this project yet, so the
//      row shapes are declared here and treated as the canonical entities.)
//   2. DTOs & Command Models      — derived from the entity row types using
//      indexed-access types (e.g. `DeckRow["name"]`) and utility types
//      (`Pick`, `Omit`, `Partial`). The API uses camelCase while the database
//      uses snake_case, so keys are remapped explicitly while value types stay
//      bound to their originating column for end-to-end type safety.
//
// Conventions:
//   - `timestamptz` columns are serialized as ISO 8601 strings.
//   - `date` columns are serialized as `YYYY-MM-DD` strings.
//   - `numeric` columns are represented as `number`.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Database entity row types (canonical entities)
// -----------------------------------------------------------------------------

/** `public.users_profiles` — one row per authenticated user. */
export interface UsersProfileRow {
  id: string;
  plan_type: PlanType;
  ai_credits_limit: number;
  ai_credits_used: number;
  /** `date` → `YYYY-MM-DD`. */
  ai_credits_reset_date: string;
  /** `timestamptz` → ISO 8601. */
  created_at: string;
  /** `timestamptz` → ISO 8601. */
  updated_at: string;
}

/** `public.decks` — user-owned flashcard collections. */
export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** `public.flashcards` — manual or AI-generated study cards with SM-2 state. */
export interface FlashcardRow {
  id: string;
  user_id: string;
  deck_id: string;
  front_text: string;
  back_text: string;
  created_by_ai: boolean;
  sm2_interval: number;
  sm2_repetition: number;
  /** `numeric(4,2)`. */
  sm2_ease_factor: number;
  /** `date` → `YYYY-MM-DD`. */
  due_at: string;
  /** `date` → `YYYY-MM-DD`, nullable. */
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.ai_generation_logs` — append-only successful-generation metadata. */
export interface AiGenerationLogRow {
  id: string;
  user_id: string;
  /** Nullable: `ON DELETE SET NULL` preserves the log after deck deletion. */
  deck_id: string | null;
  proposed_cards_count: number;
  saved_cards_count: number;
  model: string;
  created_at: string;
}

// -----------------------------------------------------------------------------
// 2. Enums and primitive unions (constrained domain values)
// -----------------------------------------------------------------------------

/** Subscription plan. MVP supports `free` only. Mirrors the DB check constraint. */
export type PlanType = "free";

/** AI models the application accepts for generation/approval. */
export type AiModel = "gpt-4o-mini";

/** Supported source-text languages for AI generation (`auto` = auto-detect). */
export type GenerationLanguage = "pl" | "en" | "auto";

/** Study review grades mapped server-side to SM-2 quality values. */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** Sort direction shared by all list endpoints. */
export type SortOrder = "asc" | "desc";

// -----------------------------------------------------------------------------
// 3. Common/shared DTOs
// -----------------------------------------------------------------------------

/** Consistent error envelope returned by every endpoint on failure. */
export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Cursor-based pagination metadata included in every list response. */
export interface PaginationDto {
  /** Opaque cursor for the next page, or `null` when there are no more pages. */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Generic `{ message }` body used by sign-out and delete endpoints. */
export interface MessageResponseDto {
  message: string;
}

/** Shared base for cursor-paginated list query parameters. */
export interface PaginationQuery {
  /** Default `20`, capped at `100`. */
  limit?: number;
  cursor?: string;
}

// -----------------------------------------------------------------------------
// 4. Authentication Session
// -----------------------------------------------------------------------------

/** Query for `GET /api/auth/google`. */
export interface StartGoogleOAuthQuery {
  /** Relative return path after auth. Defaults to `/dashboard`. */
  redirectTo?: string;
}

/** Response for `POST /api/auth/signout`. */
export type SignOutResponseDto = MessageResponseDto;

// -----------------------------------------------------------------------------
// 5. Profile  (derived from `UsersProfileRow`)
// -----------------------------------------------------------------------------

/**
 * Public profile shape for `GET /api/me`.
 * Derived from `UsersProfileRow`: snake_case columns are remapped to camelCase,
 * `user_id`-style internals are dropped, and the computed `aiCreditsRemaining`
 * (`ai_credits_limit - ai_credits_used`) is added.
 */
export interface ProfileDto {
  id: UsersProfileRow["id"];
  planType: UsersProfileRow["plan_type"];
  aiCreditsLimit: UsersProfileRow["ai_credits_limit"];
  aiCreditsUsed: UsersProfileRow["ai_credits_used"];
  /** Computed: `ai_credits_limit - ai_credits_used`. */
  aiCreditsRemaining: number;
  aiCreditsResetDate: UsersProfileRow["ai_credits_reset_date"];
  createdAt: UsersProfileRow["created_at"];
  updatedAt: UsersProfileRow["updated_at"];
}

/**
 * Dashboard counters for `GET /api/me`. These are aggregate values computed from
 * `decks` and `flashcards`, not stored columns, so they are declared as plain
 * numbers rather than derived from a single entity.
 */
export interface ProfileStatsDto {
  /** Count of `decks` for the user. */
  deckCount: number;
  /** Configured maximum (120 for MVP). */
  deckLimit: number;
  /** Count of `flashcards` where `due_at <= current_date`. */
  dueFlashcardsCount: number;
  /** Count of all `flashcards` for the user. */
  totalFlashcardsCount: number;
  /** Count of `flashcards` where `created_by_ai = true`. */
  aiCreatedFlashcardsCount: number;
}

/** Response body for `GET /api/me`. */
export interface GetProfileResponseDto {
  profile: ProfileDto;
  stats: ProfileStatsDto;
}

/**
 * AI credit status for the generation UI (`GET /api/me/ai-credits`).
 * `limit`/`used`/`resetDate` are sourced from `UsersProfileRow`; `remaining`
 * and `message` are computed presentation values.
 */
export interface AiCreditsDto {
  limit: UsersProfileRow["ai_credits_limit"];
  used: UsersProfileRow["ai_credits_used"];
  /** Computed: `limit - used`. */
  remaining: number;
  resetDate: UsersProfileRow["ai_credits_reset_date"];
  /** Friendly, non-technical message for the UI. */
  message: string;
}

/** Response body for `GET /api/me/ai-credits`. */
export interface GetAiCreditsResponseDto {
  aiCredits: AiCreditsDto;
}

// -----------------------------------------------------------------------------
// 6. Decks  (derived from `DeckRow`)
// -----------------------------------------------------------------------------

/**
 * Deck representation returned by the deck endpoints.
 * Derived from `DeckRow`: `user_id` is omitted, columns are remapped to
 * camelCase, and two computed aggregate counters are appended.
 */
export interface DeckDto {
  id: DeckRow["id"];
  name: DeckRow["name"];
  createdAt: DeckRow["created_at"];
  updatedAt: DeckRow["updated_at"];
  /** Computed: count of `flashcards` in this deck. */
  flashcardsCount: number;
  /** Computed: count of due `flashcards` (`due_at <= current_date`) in this deck. */
  dueFlashcardsCount: number;
}

/** Deck-quota information surfaced by list/create endpoints. */
export interface DeckLimitsDto {
  deckCount: number;
  deckLimit: number;
  canCreateDeck: boolean;
}

/** Query parameters for `GET /api/decks`. */
export interface ListDecksQuery extends PaginationQuery {
  sort?: "createdAt" | "updatedAt" | "name";
  order?: SortOrder;
  search?: string;
}

/** Response body for `GET /api/decks`. */
export interface ListDecksResponseDto {
  data: DeckDto[];
  pagination: PaginationDto;
  limits: DeckLimitsDto;
}

/**
 * Request body for `POST /api/decks`.
 * Picks only the user-supplied `name` from `DeckRow` (all other columns are
 * server-assigned).
 */
export type CreateDeckCommand = Pick<DeckRow, "name">;

/** Response body for `POST /api/decks`. */
export interface CreateDeckResponseDto {
  deck: DeckDto;
  limits: DeckLimitsDto;
}

/** Response body for `GET /api/decks/{deckId}`. */
export interface GetDeckResponseDto {
  deck: DeckDto;
}

/**
 * Request body for `PATCH /api/decks/{deckId}`.
 * Only `name` is mutable, so it reuses the same shape as `CreateDeckCommand`.
 */
export type RenameDeckCommand = Pick<DeckRow, "name">;

/** Response body for `PATCH /api/decks/{deckId}`. */
export interface RenameDeckResponseDto {
  deck: DeckDto;
}

/** Response body for `DELETE /api/decks/{deckId}`. */
export type DeleteDeckResponseDto = MessageResponseDto;

// -----------------------------------------------------------------------------
// 7. Flashcards  (derived from `FlashcardRow`)
// -----------------------------------------------------------------------------

/**
 * Nested SM-2 scheduling block exposed by the API.
 * Each field is bound to its originating `FlashcardRow` column so the SM-2
 * value types cannot drift from the schema.
 */
export interface Sm2Dto {
  interval: FlashcardRow["sm2_interval"];
  repetition: FlashcardRow["sm2_repetition"];
  easeFactor: FlashcardRow["sm2_ease_factor"];
  dueAt: FlashcardRow["due_at"];
  lastReviewedAt: FlashcardRow["last_reviewed_at"];
}

/**
 * Flashcard representation returned by the flashcard endpoints.
 * Derived from `FlashcardRow`: `user_id` is omitted, the flat `sm2_*` columns
 * are grouped into the nested `Sm2Dto`, and remaining columns are remapped to
 * camelCase.
 */
export interface FlashcardDto {
  id: FlashcardRow["id"];
  deckId: FlashcardRow["deck_id"];
  frontText: FlashcardRow["front_text"];
  backText: FlashcardRow["back_text"];
  createdByAi: FlashcardRow["created_by_ai"];
  sm2: Sm2Dto;
  createdAt: FlashcardRow["created_at"];
  updatedAt: FlashcardRow["updated_at"];
}

/** Query parameters for `GET /api/decks/{deckId}/flashcards`. */
export interface ListFlashcardsQuery extends PaginationQuery {
  sort?: "createdAt" | "updatedAt" | "dueAt";
  order?: SortOrder;
  createdByAi?: boolean;
  due?: "all" | "due" | "future";
  search?: string;
}

/** Response body for `GET /api/decks/{deckId}/flashcards`. */
export interface ListFlashcardsResponseDto {
  data: FlashcardDto[];
  pagination: PaginationDto;
}

/**
 * Request body for `POST /api/decks/{deckId}/flashcards`.
 * Picks only the user-supplied text columns; `user_id`, `created_by_ai`, and
 * SM-2 fields are assigned server-side. Keys are remapped to camelCase.
 */
export interface CreateFlashcardCommand {
  frontText: FlashcardRow["front_text"];
  backText: FlashcardRow["back_text"];
}

/** Response body for `POST /api/decks/{deckId}/flashcards`. */
export interface CreateFlashcardResponseDto {
  flashcard: FlashcardDto;
}

/** Response body for `GET /api/flashcards/{flashcardId}`. */
export interface GetFlashcardResponseDto {
  flashcard: FlashcardDto;
}

/**
 * Request body for `PATCH /api/flashcards/{flashcardId}`.
 * Only the text fields are editable and both are optional (`Partial`).
 * `deckId`, `createdByAi`, and SM-2 fields are immutable through this endpoint.
 */
export type UpdateFlashcardCommand = Partial<CreateFlashcardCommand>;

/** Response body for `PATCH /api/flashcards/{flashcardId}`. */
export interface UpdateFlashcardResponseDto {
  flashcard: FlashcardDto;
}

/** Response body for `DELETE /api/flashcards/{flashcardId}`. */
export type DeleteFlashcardResponseDto = MessageResponseDto;

/** Response body for `DELETE /api/decks/{deckId}/flashcards`. */
export interface ClearDeckFlashcardsResponseDto {
  message: string;
  deletedCount: number;
}

// -----------------------------------------------------------------------------
// 8. AI Flashcard Workflow
// -----------------------------------------------------------------------------

/**
 * A single proposed/approved card. Reuses the flashcard text columns; this is
 * the unit exchanged with the AI provider and with the approval endpoint.
 */
export interface AiProposalCardDto {
  frontText: FlashcardRow["front_text"];
  backText: FlashcardRow["back_text"];
}

/**
 * Client-side request contract for the direct browser-to-provider generation
 * call (not an application REST endpoint in the MVP).
 */
export interface GenerateProposalsCommand {
  /** 20–10,000 characters after trimming. */
  sourceText: string;
  /** Optional instruction, capped at 500 characters. Never persisted. */
  instructions?: string;
  language: GenerationLanguage;
  model: AiModel;
}

/** Client-side proposal payload returned by the AI provider. */
export interface AiProposalsDto {
  cards: AiProposalCardDto[];
  model: AiModel;
}

/**
 * Request body for `POST /api/ai/flashcards/approve`.
 * `deckId` maps to `FlashcardRow["deck_id"]`; `proposedCardsCount`/`model` map
 * to `AiGenerationLogRow` columns; `cards` are the user-selected proposals.
 */
export interface ApproveAiFlashcardsCommand {
  deckId: FlashcardRow["deck_id"];
  proposedCardsCount: AiGenerationLogRow["proposed_cards_count"];
  model: AiModel;
  cards: AiProposalCardDto[];
}

/**
 * Generation-log metadata returned inside the approval response.
 * Derived from `AiGenerationLogRow` with `user_id` omitted and `deck_id`
 * narrowed to non-null (an approval always targets a deck). Keys remapped to
 * camelCase.
 */
export interface GenerationLogDto {
  id: AiGenerationLogRow["id"];
  deckId: NonNullable<AiGenerationLogRow["deck_id"]>;
  proposedCardsCount: AiGenerationLogRow["proposed_cards_count"];
  savedCardsCount: AiGenerationLogRow["saved_cards_count"];
  model: AiGenerationLogRow["model"];
  createdAt: AiGenerationLogRow["created_at"];
}

/** Response body for `POST /api/ai/flashcards/approve`. */
export interface ApproveAiFlashcardsResponseDto {
  savedCards: FlashcardDto[];
  generationLog: GenerationLogDto;
  /** Post-approval credit summary (omits the UI `message` field). */
  aiCredits: Omit<AiCreditsDto, "message">;
}

/** Query parameters for `GET /api/ai/generation-logs`. */
export interface ListGenerationLogsQuery extends PaginationQuery {
  deckId?: string;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  to?: string;
  sort?: "createdAt";
  order?: SortOrder;
}

/**
 * A generation-log list item for `GET /api/ai/generation-logs`.
 * Extends `GenerationLogDto` with the computed `acceptanceRate`
 * (`saved_cards_count / proposed_cards_count`).
 */
export interface AiGenerationLogListItemDto extends GenerationLogDto {
  /** Computed: `savedCardsCount / proposedCardsCount` (0 when none proposed). */
  acceptanceRate: number;
}

/** Response body for `GET /api/ai/generation-logs`. */
export interface ListGenerationLogsResponseDto {
  data: AiGenerationLogListItemDto[];
  pagination: PaginationDto;
}

// -----------------------------------------------------------------------------
// 9. Study Mode
// -----------------------------------------------------------------------------

/** Query parameters for `GET /api/study/due`. */
export interface GetStudyDueQuery extends PaginationQuery {
  deckId?: string;
  /** Include a small count of upcoming cards (without full content). Default `false`. */
  includeFuturePreview?: boolean;
}

/**
 * A due-card entry for the study queue.
 * Derived from `FlashcardDto` by omitting metadata not needed during review
 * (`createdByAi`, `createdAt`, `updatedAt`).
 */
export type StudyQueueItemDto = Omit<FlashcardDto, "createdByAi" | "createdAt" | "updatedAt">;

/** Aggregate summary for the study queue. */
export interface StudyDueSummaryDto {
  dueCount: number;
  suggestedTodayCount: number;
  upcomingCount: number;
}

/** Response body for `GET /api/study/due`. */
export interface GetStudyDueResponseDto {
  data: StudyQueueItemDto[];
  pagination: PaginationDto;
  summary: StudyDueSummaryDto;
}

/**
 * Request body for `POST /api/study/reviews`.
 * `flashcardId` is bound to `FlashcardRow["id"]`; the server computes all SM-2
 * updates from `grade`.
 */
export interface SubmitReviewCommand {
  flashcardId: FlashcardRow["id"];
  grade: ReviewGrade;
}

/** Response body for `POST /api/study/reviews`. */
export interface SubmitReviewResponseDto {
  flashcard: FlashcardDto;
  /** Remaining due-card count after this review. */
  nextDueCount: number;
}

// -----------------------------------------------------------------------------
// 10. Analytics Summary
// -----------------------------------------------------------------------------

/** Query parameters for `GET /api/analytics/summary`. */
export interface GetAnalyticsSummaryQuery {
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  to?: string;
  deckId?: string;
}

/**
 * MVP success-metric summary for the authenticated user.
 * All fields are aggregates computed from `flashcards` and `ai_generation_logs`.
 */
export interface AnalyticsSummaryDto {
  /** `saved_cards_count / proposed_cards_count` across generation logs. */
  aiAcceptanceRate: number;
  /** AI-created flashcards / all flashcards. */
  aiAdoptionRate: number;
  proposedCardsCount: number;
  savedAiCardsCount: number;
  totalFlashcardsCount: number;
  aiCreatedFlashcardsCount: number;
}

/** Response body for `GET /api/analytics/summary`. */
export interface GetAnalyticsSummaryResponseDto {
  analytics: AnalyticsSummaryDto;
}
