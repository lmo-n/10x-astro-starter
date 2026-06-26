import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiGenerationLogListItemDto,
  AiGenerationLogRow,
  AnalyticsSummaryDto,
  GetAnalyticsSummaryResponseDto,
  ListGenerationLogsResponseDto,
  PaginationDto,
  SortOrder,
} from "@/types";
import type { AnalyticsSummaryInput, ListGenerationLogsInput } from "@/lib/validation/ai";

/** Error codes surfaced by the AI service so the route can map them to HTTP. */
export type AiServiceErrorCode = "AI_LIST_FAILED" | "ANALYTICS_FAILED" | "DECK_NOT_FOUND" | "INVALID_QUERY";

/**
 * Domain error thrown by the AI service. The `code` is mapped to an HTTP
 * status / `ApiErrorDto.error.code` by the route handler.
 */
export class AiServiceError extends Error {
  readonly code: AiServiceErrorCode;

  constructor(code: AiServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiServiceError";
    this.code = code;
  }
}

// -----------------------------------------------------------------------------
// Cursor pagination helpers
// -----------------------------------------------------------------------------

/** Keyset anchor embedded in an opaque cursor. */
interface CursorAnchor {
  order: SortOrder;
  value: string;
  id: string;
}

/** Encode a keyset anchor as an opaque base64 cursor. */
function encodeCursor(anchor: CursorAnchor): string {
  return Buffer.from(JSON.stringify(anchor), "utf8").toString("base64");
}

/**
 * Decode and validate an opaque cursor against the current query shape.
 *
 * @throws {AiServiceError} `INVALID_QUERY` when the cursor is malformed or
 *         was issued for a different `order`.
 */
function decodeCursor(raw: string, order: SortOrder): CursorAnchor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    throw new AiServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as CursorAnchor).value !== "string" ||
    typeof (parsed as CursorAnchor).id !== "string" ||
    (parsed as CursorAnchor).order !== order
  ) {
    throw new AiServiceError("INVALID_QUERY", "Invalid pagination cursor.");
  }

  return parsed as CursorAnchor;
}

// -----------------------------------------------------------------------------
// Row mapper
// -----------------------------------------------------------------------------

type LogRow = Pick<
  AiGenerationLogRow,
  "id" | "deck_id" | "proposed_cards_count" | "saved_cards_count" | "model" | "created_at"
>;

function toListItemDto(row: LogRow): AiGenerationLogListItemDto {
  const proposed = row.proposed_cards_count;
  const saved = row.saved_cards_count;
  return {
    id: row.id,
    deckId: row.deck_id ?? "",
    proposedCardsCount: proposed,
    savedCardsCount: saved,
    acceptanceRate: proposed > 0 ? saved / proposed : 0,
    model: row.model,
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------------
// Public service function
// -----------------------------------------------------------------------------

const LOG_COLUMNS = "id, deck_id, proposed_cards_count, saved_cards_count, model, created_at";

/**
 * List the authenticated user's AI generation logs with cursor-based
 * pagination and optional date/deck filters.
 *
 * Uses keyset pagination on `(created_at, id)` to keep latency constant as
 * the table grows. Fetches `limit + 1` rows to determine `hasMore`.
 *
 * @param supabase Authenticated Supabase SSR client (RLS scopes reads to the user).
 * @param userId   Owner id, always derived from the session — never the request.
 * @param query    Validated query parameters.
 * @throws {AiServiceError} `INVALID_QUERY` for a malformed cursor;
 *         `AI_LIST_FAILED` for any query failure.
 */
export async function listGenerationLogs(
  supabase: SupabaseClient,
  userId: string,
  query: ListGenerationLogsInput,
): Promise<ListGenerationLogsResponseDto> {
  const { limit, cursor, deckId, from, to, order } = query;
  const ascending = order === "asc";

  // 1. Base query scoped to the owner.
  let builder = supabase.from("ai_generation_logs").select(LOG_COLUMNS).eq("user_id", userId);

  // 2. Optional deck filter (user can only see their own logs via RLS anyway).
  if (deckId) {
    builder = builder.eq("deck_id", deckId);
  }

  // 3. Optional date range on `created_at`.
  if (from) {
    builder = builder.gte("created_at", `${from}T00:00:00.000Z`);
  }
  if (to) {
    builder = builder.lte("created_at", `${to}T23:59:59.999Z`);
  }

  // 4. Keyset predicate from the cursor (if any).
  if (cursor) {
    const anchor = decodeCursor(cursor, order);
    const op = ascending ? "gt" : "lt";
    const tiebreak = ascending ? "gt" : "lt";
    builder = builder.or(
      `created_at.${op}.${anchor.value},and(created_at.eq.${anchor.value},id.${tiebreak}.${anchor.id})`,
    );
  }

  // 5. Stable ordering + fetch one extra row to detect the next page.
  const { data, error } = await builder
    .order("created_at", { ascending })
    .order("id", { ascending })
    .limit(limit + 1);

  if (error) {
    throw new AiServiceError("AI_LIST_FAILED", "Failed to list generation logs.", { cause: error });
  }

  const rows = (data ?? []) as LogRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // 6. Build next cursor from the last page row.
  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({ order, value: last.created_at, id: last.id });
  }

  const pagination: PaginationDto = { nextCursor, hasMore };

  return {
    data: pageRows.map(toListItemDto),
    pagination,
  };
}

// -----------------------------------------------------------------------------
// Analytics summary (GET /api/analytics/summary)
// -----------------------------------------------------------------------------

/**
 * Compute MVP success-metric aggregates for the authenticated user.
 *
 * Runs a deck ownership check (when `deckId` is supplied) plus four parallel
 * queries — two aggregate fetches from `ai_generation_logs` and two count
 * queries on `flashcards` — to minimise latency.
 *
 * @param supabase Authenticated Supabase SSR client.
 * @param userId   Owner id, always derived from the session.
 * @param query    Validated query parameters.
 * @throws {AiServiceError} `DECK_NOT_FOUND` when `deckId` is not owned by the user;
 *         `ANALYTICS_FAILED` for any query failure.
 */
export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  query: AnalyticsSummaryInput,
): Promise<GetAnalyticsSummaryResponseDto> {
  const { deckId, from, to } = query;

  // 1. Verify deck ownership when a deckId filter is supplied.
  if (deckId) {
    const { count, error } = await supabase
      .from("decks")
      .select("id", { count: "exact", head: true })
      .eq("id", deckId)
      .eq("user_id", userId);

    if (error) {
      throw new AiServiceError("ANALYTICS_FAILED", "Failed to verify deck ownership.", { cause: error });
    }
    if (!count) {
      throw new AiServiceError("DECK_NOT_FOUND", "Deck not found.");
    }
  }

  // Helper: apply shared date filters to any Supabase query builder.
  function applyDateFilters<T extends ReturnType<typeof supabase.from>>(builder: T): T {
    let b = builder as unknown as ReturnType<typeof supabase.from>;
    if (from) b = b.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) b = b.lte("created_at", `${to}T23:59:59.999Z`);
    return b as unknown as T;
  }

  // 2. Build the four parallel queries.
  let logsQuery = supabase
    .from("ai_generation_logs")
    .select("proposed_cards_count, saved_cards_count")
    .eq("user_id", userId);
  if (deckId) logsQuery = logsQuery.eq("deck_id", deckId);
  logsQuery = applyDateFilters(logsQuery);

  let totalCardsQuery = supabase.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (deckId) totalCardsQuery = totalCardsQuery.eq("deck_id", deckId);
  totalCardsQuery = applyDateFilters(totalCardsQuery);

  let aiCardsQuery = supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("created_by_ai", true);
  if (deckId) aiCardsQuery = aiCardsQuery.eq("deck_id", deckId);
  aiCardsQuery = applyDateFilters(aiCardsQuery);

  const [logsResult, totalCardsResult, aiCardsResult] = await Promise.all([logsQuery, totalCardsQuery, aiCardsQuery]);

  const queryError = logsResult.error ?? totalCardsResult.error ?? aiCardsResult.error;
  if (queryError) {
    throw new AiServiceError("ANALYTICS_FAILED", "Failed to load analytics data.", { cause: queryError });
  }

  // 3. Sum generation log counts in JS (no PostgREST aggregate needed).
  const logRows = (logsResult.data ?? []) as { proposed_cards_count: number; saved_cards_count: number }[];
  const proposedCardsCount = logRows.reduce((sum, r) => sum + r.proposed_cards_count, 0);
  const savedAiCardsCount = logRows.reduce((sum, r) => sum + r.saved_cards_count, 0);

  const totalFlashcardsCount = totalCardsResult.count ?? 0;
  const aiCreatedFlashcardsCount = aiCardsResult.count ?? 0;

  const analytics: AnalyticsSummaryDto = {
    aiAcceptanceRate: proposedCardsCount > 0 ? savedAiCardsCount / proposedCardsCount : 0,
    aiAdoptionRate: totalFlashcardsCount > 0 ? aiCreatedFlashcardsCount / totalFlashcardsCount : 0,
    proposedCardsCount,
    savedAiCardsCount,
    totalFlashcardsCount,
    aiCreatedFlashcardsCount,
  };

  return { analytics };
}
