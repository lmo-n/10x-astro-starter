import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProfile, ProfileServiceError } from "./profile.service";
import { DECK_LIMIT } from "./deck.service";

interface PostgrestLikeError {
  message: string;
}

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error: PostgrestLikeError | null;
}

interface MockResults {
  profile: QueryResult;
  deckCount: QueryResult;
  totalCards: QueryResult;
  dueCards: QueryResult;
  aiCards: QueryResult;
}

/**
 * Build a Supabase mock that returns a thenable query builder per `.from()`
 * call. Each builder resolves (via `await` or `.maybeSingle()`) to a fixed
 * result. The three `flashcards` queries are dispensed in issue order
 * (total → due → ai), matching the `Promise.all` array in `getProfile`.
 */
function makeSupabase(results: MockResults): SupabaseClient {
  const flashcardsQueue: QueryResult[] = [results.totalCards, results.dueCards, results.aiCards];

  function thenable(result: QueryResult) {
    const obj = {
      select: () => obj,
      eq: () => obj,
      lte: () => obj,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  }

  const from = (table: string) => {
    if (table === "users_profiles") return thenable(results.profile);
    if (table === "decks") return thenable(results.deckCount);
    if (table === "flashcards") {
      const next = flashcardsQueue.shift();
      if (!next) throw new Error("unexpected extra flashcards query");
      return thenable(next);
    }
    throw new Error(`unexpected table ${table}`);
  };

  return { from } as unknown as SupabaseClient;
}

const PROFILE_ROW = {
  id: "user-1",
  plan_type: "free",
  ai_credits_limit: 50,
  ai_credits_used: 12,
  ai_credits_reset_date: "2026-07-01",
  created_at: "2026-06-01T10:00:00.000Z",
  updated_at: "2026-06-18T08:30:00.000Z",
};

function baseResults(): MockResults {
  return {
    profile: { data: PROFILE_ROW, error: null },
    deckCount: { count: 7, error: null },
    totalCards: { count: 210, error: null },
    dueCards: { count: 33, error: null },
    aiCards: { count: 95, error: null },
  };
}

describe("getProfile", () => {
  it("returns the mapped profile with computed aiCreditsRemaining and stats", async () => {
    const client = makeSupabase(baseResults());

    const result = await getProfile(client, "user-1");

    expect(result.profile).toEqual({
      id: "user-1",
      planType: "free",
      aiCreditsLimit: 50,
      aiCreditsUsed: 12,
      aiCreditsRemaining: 38,
      aiCreditsResetDate: "2026-07-01",
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-18T08:30:00.000Z",
    });
    expect(result.stats).toEqual({
      deckCount: 7,
      deckLimit: DECK_LIMIT,
      dueFlashcardsCount: 33,
      totalFlashcardsCount: 210,
      aiCreatedFlashcardsCount: 95,
    });
  });

  it("treats null counts as zero", async () => {
    const results = baseResults();
    results.deckCount.count = null;
    results.totalCards.count = null;
    results.dueCards.count = null;
    results.aiCards.count = null;
    const client = makeSupabase(results);

    const result = await getProfile(client, "user-1");

    expect(result.stats).toEqual({
      deckCount: 0,
      deckLimit: DECK_LIMIT,
      dueFlashcardsCount: 0,
      totalFlashcardsCount: 0,
      aiCreatedFlashcardsCount: 0,
    });
  });

  it("throws PROFILE_NOT_FOUND when the profile row is missing", async () => {
    const results = baseResults();
    results.profile = { data: null, error: null };
    const client = makeSupabase(results);

    await expect(getProfile(client, "user-1")).rejects.toBeInstanceOf(ProfileServiceError);
    await expect(getProfile(makeSupabase(results), "user-1")).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });

  it("throws PROFILE_FETCH_FAILED when the profile query fails", async () => {
    const results = baseResults();
    results.profile = { data: null, error: { message: "permission denied" } };

    await expect(getProfile(makeSupabase(results), "user-1")).rejects.toMatchObject({
      code: "PROFILE_FETCH_FAILED",
    });
  });

  it("throws PROFILE_FETCH_FAILED when a count query fails", async () => {
    const results = baseResults();
    results.dueCards = { count: null, error: { message: "count failed" } };

    await expect(getProfile(makeSupabase(results), "user-1")).rejects.toMatchObject({
      code: "PROFILE_FETCH_FAILED",
    });
  });
});
