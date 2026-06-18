import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateSm2Schedule,
  getDueStudyQueue,
  submitStudyReview,
  toStudyQueueItemDto,
  StudyServiceError,
} from "./study.service";
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

describe("calculateSm2Schedule", () => {
  const TODAY = "2026-06-17";

  it("gives a distinct first interval for each grade on a brand-new card", () => {
    const base = { interval: 0, repetition: 0, easeFactor: 2.5 };

    expect(calculateSm2Schedule(base, "again", TODAY).interval).toBe(1);
    expect(calculateSm2Schedule(base, "hard", TODAY).interval).toBe(2);
    expect(calculateSm2Schedule(base, "good", TODAY).interval).toBe(4);
    expect(calculateSm2Schedule(base, "easy", TODAY).interval).toBe(7);
  });

  it("schedules a brand-new card 4 days out on the first `good` review", () => {
    const schedule = calculateSm2Schedule({ interval: 0, repetition: 0, easeFactor: 2.5 }, "good", TODAY);

    expect(schedule.repetition).toBe(1);
    expect(schedule.interval).toBe(4);
    expect(schedule.dueAt).toBe("2026-06-21");
    expect(schedule.lastReviewedAt).toBe(TODAY);
  });

  it("grows the interval by the ease factor on a later `good` review", () => {
    const schedule = calculateSm2Schedule({ interval: 6, repetition: 1, easeFactor: 2.5 }, "good", TODAY);

    expect(schedule.repetition).toBe(2);
    // EF' = 2.5 (q=4 delta 0); 6 * 2.5 = 15.
    expect(schedule.interval).toBe(15);
  });

  it("grows more slowly on `hard` than on `good`, but always by at least one day", () => {
    const current = { interval: 6, repetition: 2, easeFactor: 2.5 };
    const hard = calculateSm2Schedule(current, "hard", TODAY);
    const good = calculateSm2Schedule(current, "good", TODAY);

    // hard → round(6 * 1.2) = 7; good → round(6 * EF').
    expect(hard.interval).toBe(7);
    expect(good.interval).toBeGreaterThan(hard.interval);
  });

  it("applies the easy bonus so `easy` outpaces `good`", () => {
    const current = { interval: 10, repetition: 2, easeFactor: 2.5 };
    const good = calculateSm2Schedule(current, "good", TODAY);
    const easy = calculateSm2Schedule(current, "easy", TODAY);

    // good → round(10 * 2.5) = 25; easy → round(10 * 2.6 * 1.3) = 34.
    expect(good.interval).toBe(25);
    expect(easy.interval).toBe(34);
    expect(easy.interval).toBeGreaterThan(good.interval);
  });

  it("resets the repetition run and reschedules tomorrow on `again`", () => {
    const schedule = calculateSm2Schedule({ interval: 15, repetition: 3, easeFactor: 2.5 }, "again", TODAY);

    expect(schedule.repetition).toBe(0);
    expect(schedule.interval).toBe(1);
    expect(schedule.dueAt).toBe("2026-06-18");
  });

  it("lowers the ease factor on `hard` and clamps it at the 1.3 minimum", () => {
    const schedule = calculateSm2Schedule({ interval: 6, repetition: 2, easeFactor: 1.3 }, "hard", TODAY);

    // q=3 → EF delta = 0.1 - 2*(0.08 + 2*0.02) = -0.14 → clamped to 1.3.
    expect(schedule.easeFactor).toBe(1.3);
    expect(schedule.repetition).toBe(3);
  });

  it("raises the ease factor on `easy`", () => {
    const schedule = calculateSm2Schedule({ interval: 1, repetition: 1, easeFactor: 2.5 }, "easy", TODAY);

    // q=5 → EF delta = +0.1 → 2.6.
    expect(schedule.easeFactor).toBe(2.6);
  });
});

interface ReviewSupabaseOptions {
  fetch?: QueryResult;
  update?: QueryResult;
  count?: QueryResult;
}

/**
 * A chainable builder that also supports `.update(...)` for the review flow.
 * Captures the payload passed to `update` so tests can assert which columns are
 * written.
 */
function makeReviewBuilder(result: QueryResult, captured: { updatePayload?: Record<string, unknown> }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.update = vi.fn((payload: Record<string, unknown>) => {
    captured.updatePayload = payload;
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown) => resolve(result);
  return builder;
}

/** Build a Supabase mock that serves the fetch, update, then count queries. */
function makeReviewSupabase(opts: ReviewSupabaseOptions) {
  const captured: { updatePayload?: Record<string, unknown> } = {};
  const queue: QueryResult[] = [];
  queue.push(opts.fetch ?? { data: makeRow(), error: null });
  queue.push(opts.update ?? { data: makeRow(), error: null });
  queue.push(opts.count ?? { count: 0, error: null });

  const from = vi.fn(() => makeReviewBuilder(queue.shift() ?? { data: null, error: null }, captured));
  const client = { from } as unknown as SupabaseClient;
  return { client, captured };
}

describe("submitStudyReview", () => {
  it("updates only scheduling columns and returns the updated card + nextDueCount", async () => {
    const updatedRow = makeRow({
      sm2_interval: 1,
      sm2_repetition: 1,
      sm2_ease_factor: 2.5,
      due_at: "2026-06-18",
      last_reviewed_at: "2026-06-17",
    });
    const { client, captured } = makeReviewSupabase({
      fetch: { data: makeRow(), error: null },
      update: { data: updatedRow, error: null },
      count: { count: 4, error: null },
    });

    const result = await submitStudyReview(client, "user-1", { flashcardId: "card-1", grade: "good" });

    expect(result.flashcard.id).toBe("card-1");
    expect(result.flashcard.sm2.dueAt).toBe("2026-06-18");
    expect(result.nextDueCount).toBe(4);
    // Only scheduling columns are written — never text/deck/ownership/AI metadata.
    expect(Object.keys(captured.updatePayload ?? {}).sort()).toEqual([
      "due_at",
      "last_reviewed_at",
      "sm2_ease_factor",
      "sm2_interval",
      "sm2_repetition",
    ]);
  });

  it("throws FLASHCARD_NOT_FOUND when the card is missing or foreign", async () => {
    const { client } = makeReviewSupabase({ fetch: { data: null, error: null } });

    await expect(submitStudyReview(client, "user-1", { flashcardId: "card-1", grade: "good" })).rejects.toMatchObject({
      code: "FLASHCARD_NOT_FOUND",
    });
  });

  it("throws REVIEW_SAVE_FAILED when the fetch query fails", async () => {
    const { client } = makeReviewSupabase({ fetch: { data: null, error: { message: "boom" } } });

    await expect(submitStudyReview(client, "user-1", { flashcardId: "card-1", grade: "good" })).rejects.toMatchObject({
      code: "REVIEW_SAVE_FAILED",
    });
  });

  it("throws REVIEW_SAVE_FAILED when the update fails", async () => {
    const { client } = makeReviewSupabase({
      fetch: { data: makeRow(), error: null },
      update: { data: null, error: { message: "boom" } },
    });

    await expect(submitStudyReview(client, "user-1", { flashcardId: "card-1", grade: "good" })).rejects.toMatchObject({
      code: "REVIEW_SAVE_FAILED",
    });
  });

  it("throws REVIEW_SAVE_FAILED when the due-count query fails", async () => {
    const { client } = makeReviewSupabase({
      fetch: { data: makeRow(), error: null },
      update: { data: makeRow(), error: null },
      count: { count: null, error: { message: "boom" } },
    });

    await expect(submitStudyReview(client, "user-1", { flashcardId: "card-1", grade: "good" })).rejects.toMatchObject({
      code: "REVIEW_SAVE_FAILED",
    });
  });
});
