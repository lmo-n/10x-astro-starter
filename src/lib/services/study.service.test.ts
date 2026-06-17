import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDueStudyQueue, toStudyQueueItemDto, StudyServiceError } from "./study.service";
import type { FlashcardRow } from "@/types";
import type { StudyDueInput } from "@/lib/validation/study";

interface PostgrestLikeError {
  message: string;
}

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error: PostgrestLikeError | null;
}

/**
 * A chainable, thenable stand-in for the Supabase query builder. Every chain
 * method returns the same builder so any call order resolves to `result`,
 * whether the caller awaits the builder directly (count/page queries) or calls
 * `.maybeSingle()` (deck ownership check).
 */
function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte", "gt", "or", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown) => resolve(result);
  return builder;
}

interface SupabaseOptions {
  deck?: QueryResult;
  page?: QueryResult;
  dueCount?: QueryResult;
  upcomingCount?: QueryResult;
}

/**
 * Build a mock Supabase client. `decks` queries resolve to `deck`; successive
 * `flashcards` queries resolve to `page`, then `dueCount`, then `upcomingCount`
 * in the order the service issues them.
 */
function makeSupabase(opts: SupabaseOptions) {
  const flashcardQueue: QueryResult[] = [];
  if (opts.page) flashcardQueue.push(opts.page);
  if (opts.dueCount) flashcardQueue.push(opts.dueCount);
  if (opts.upcomingCount) flashcardQueue.push(opts.upcomingCount);

  const deckBuilder = makeBuilder(opts.deck ?? { data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === "decks") {
      return deckBuilder;
    }
    const next = flashcardQueue.shift() ?? { data: [], error: null };
    return makeBuilder(next);
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, from, deckBuilder };
}

function makeRow(overrides: Partial<FlashcardRow> = {}): FlashcardRow {
  return {
    id: "card-1",
    user_id: "user-1",
    deck_id: "deck-1",
    front_text: "What is osmosis?",
    back_text: "Movement of water across a semipermeable membrane.",
    created_by_ai: false,
    sm2_interval: 0,
    sm2_repetition: 0,
    sm2_ease_factor: 2.5,
    due_at: "2026-06-16",
    last_reviewed_at: null,
    created_at: "2026-06-16T10:00:00.000Z",
    updated_at: "2026-06-16T10:00:00.000Z",
    ...overrides,
  };
}

const BASE_QUERY: StudyDueInput = { limit: 20, includeFuturePreview: false };

describe("toStudyQueueItemDto", () => {
  it("maps a row to a queue item without createdByAi/createdAt/updatedAt", () => {
    const item = toStudyQueueItemDto(makeRow());

    expect(item).toEqual({
      id: "card-1",
      deckId: "deck-1",
      frontText: "What is osmosis?",
      backText: "Movement of water across a semipermeable membrane.",
      sm2: {
        interval: 0,
        repetition: 0,
        easeFactor: 2.5,
        dueAt: "2026-06-16",
        lastReviewedAt: null,
      },
    });
    expect(item).not.toHaveProperty("createdByAi");
    expect(item).not.toHaveProperty("createdAt");
    expect(item).not.toHaveProperty("updatedAt");
  });
});

describe("getDueStudyQueue", () => {
  it("returns due cards with summary and no upcoming count by default", async () => {
    const { client } = makeSupabase({
      page: { data: [makeRow()], error: null },
      dueCount: { count: 1, error: null },
    });

    const result = await getDueStudyQueue(client, "user-1", BASE_QUERY);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("card-1");
    expect(result.pagination).toEqual({ nextCursor: null, hasMore: false });
    expect(result.summary).toEqual({ dueCount: 1, suggestedTodayCount: 1, upcomingCount: 0 });
  });

  it("caps suggestedTodayCount at 25", async () => {
    const { client } = makeSupabase({
      page: { data: [makeRow()], error: null },
      dueCount: { count: 40, error: null },
    });

    const result = await getDueStudyQueue(client, "user-1", BASE_QUERY);

    expect(result.summary.dueCount).toBe(40);
    expect(result.summary.suggestedTodayCount).toBe(25);
  });

  it("trims the extra row and emits a nextCursor when more pages exist", async () => {
    const rows = [makeRow({ id: "card-1" }), makeRow({ id: "card-2" }), makeRow({ id: "card-3" })];
    const { client } = makeSupabase({
      page: { data: rows, error: null },
      dueCount: { count: 3, error: null },
    });

    const result = await getDueStudyQueue(client, "user-1", { limit: 2, includeFuturePreview: false });

    expect(result.data).toHaveLength(2);
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).toBeTypeOf("string");
  });

  it("counts upcoming cards when includeFuturePreview is true", async () => {
    const { client } = makeSupabase({
      page: { data: [makeRow()], error: null },
      dueCount: { count: 1, error: null },
      upcomingCount: { count: 7, error: null },
    });

    const result = await getDueStudyQueue(client, "user-1", { limit: 20, includeFuturePreview: true });

    expect(result.summary.upcomingCount).toBe(7);
  });

  it("verifies deck ownership and throws DECK_NOT_FOUND for a foreign deck", async () => {
    const { client } = makeSupabase({
      deck: { data: null, error: null },
    });

    await expect(
      getDueStudyQueue(client, "user-1", {
        deckId: "11111111-1111-4111-8111-111111111111",
        limit: 20,
        includeFuturePreview: false,
      }),
    ).rejects.toMatchObject({ code: "DECK_NOT_FOUND" });
  });

  it("proceeds when the deck filter is owned by the user", async () => {
    const { client } = makeSupabase({
      deck: { data: { id: "deck-1" }, error: null },
      page: { data: [makeRow()], error: null },
      dueCount: { count: 1, error: null },
    });

    const result = await getDueStudyQueue(client, "user-1", {
      deckId: "11111111-1111-4111-8111-111111111111",
      limit: 20,
      includeFuturePreview: false,
    });

    expect(result.data).toHaveLength(1);
  });

  it("throws STUDY_QUEUE_FAILED when the page query fails", async () => {
    const { client } = makeSupabase({
      page: { data: null, error: { message: "boom" } },
    });

    await expect(getDueStudyQueue(client, "user-1", BASE_QUERY)).rejects.toMatchObject({
      code: "STUDY_QUEUE_FAILED",
    });
  });

  it("throws STUDY_QUEUE_FAILED when the due-count query fails", async () => {
    const { client } = makeSupabase({
      page: { data: [makeRow()], error: null },
      dueCount: { count: null, error: { message: "boom" } },
    });

    await expect(getDueStudyQueue(client, "user-1", BASE_QUERY)).rejects.toMatchObject({
      code: "STUDY_QUEUE_FAILED",
    });
  });

  it("throws INVALID_QUERY for a malformed cursor", async () => {
    const { client } = makeSupabase({
      page: { data: [makeRow()], error: null },
      dueCount: { count: 1, error: null },
    });

    await expect(
      getDueStudyQueue(client, "user-1", { limit: 20, cursor: "!!!not-base64-json!!!", includeFuturePreview: false }),
    ).rejects.toBeInstanceOf(StudyServiceError);
  });
});
