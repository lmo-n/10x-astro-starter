import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDeck, listDecks, renameDeck, deleteDeck, DeckServiceError, DECK_LIMIT } from "./deck.service";
import type { ListDecksInput } from "@/lib/validation/decks";

interface PostgrestLikeError {
  message: string;
}

interface InsertResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

interface CountResult {
  count: number | null;
  error: PostgrestLikeError | null;
}

/**
 * Build a minimal mock that mimics the two Supabase query chains used by
 * `createDeck`:
 *   - insert: `.from().insert().select().single()`
 *   - count:  `.from().select(..., { head }).eq()`
 */
function makeSupabase(insertResult: InsertResult, countResult: CountResult) {
  const single = vi.fn().mockResolvedValue(insertResult);
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const eq = vi.fn().mockResolvedValue(countResult);
  const countSelect = vi.fn(() => ({ eq }));

  const from = vi.fn(() => ({ insert, select: countSelect }));

  const client = { from } as unknown as SupabaseClient;
  return { client, insert };
}

const VALID_ROW = {
  id: "deck-1",
  name: "Biology 101",
  created_at: "2026-06-12T10:00:00.000Z",
  updated_at: "2026-06-12T10:00:00.000Z",
};

describe("createDeck", () => {
  it("creates a deck and returns DeckDto with zeroed counters", async () => {
    const { client, insert } = makeSupabase({ data: VALID_ROW, error: null }, { count: 5, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", name: "Biology 101" });
    expect(result.deck).toEqual({
      id: "deck-1",
      name: "Biology 101",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:00.000Z",
      flashcardsCount: 0,
      dueFlashcardsCount: 0,
    });
    expect(result.limits).toEqual({
      deckCount: 5,
      deckLimit: DECK_LIMIT,
      canCreateDeck: true,
    });
  });

  it("reports canCreateDeck=false when the deck count reaches the limit", async () => {
    const { client } = makeSupabase({ data: VALID_ROW, error: null }, { count: DECK_LIMIT, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(result.limits.canCreateDeck).toBe(false);
    expect(result.limits.deckCount).toBe(DECK_LIMIT);
  });

  it("treats a null count as zero", async () => {
    const { client } = makeSupabase({ data: VALID_ROW, error: null }, { count: null, error: null });

    const result = await createDeck(client, "user-1", { name: "Biology 101" });

    expect(result.limits.deckCount).toBe(0);
  });

  it("throws DECK_LIMIT_REACHED when the enforce_deck_limit trigger fires", async () => {
    const { client } = makeSupabase(
      { data: null, error: { message: "Deck limit reached: a user may own at most 120 decks." } },
      { count: 0, error: null },
    );

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_LIMIT_REACHED",
    });
  });

  it("throws DECK_CREATE_FAILED on a generic insert error", async () => {
    const { client } = makeSupabase({ data: null, error: { message: "permission denied" } }, { count: 0, error: null });

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toBeInstanceOf(DeckServiceError);
    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_CREATE_FAILED",
    });
  });

  it("throws DECK_CREATE_FAILED when the count query fails", async () => {
    const { client } = makeSupabase(
      { data: VALID_ROW, error: null },
      { count: null, error: { message: "count failed" } },
    );

    await expect(createDeck(client, "user-1", { name: "Biology 101" })).rejects.toMatchObject({
      code: "DECK_CREATE_FAILED",
    });
  });
});

interface MaybeSingleResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

/**
 * Build a mock that mimics the query chains used by `renameDeck`:
 *   - update: `.from().update().eq().eq().select().maybeSingle()`
 *   - total count: `.from().select(..., { head }).eq().eq()`
 *   - due count:   `.from().select(..., { head }).eq().eq().lte()`
 *
 * The total and due count chains are distinguished by the presence of a final
 * `.lte()` call, so each returns its own configured result.
 */
function makeRenameSupabase(
  updateResult: MaybeSingleResult,
  totalResult: CountResult = { count: 0, error: null },
  dueResult: CountResult = { count: 0, error: null },
) {
  const maybeSingle = vi.fn().mockResolvedValue(updateResult);
  // update chain: select() then maybeSingle()
  const updateSelect = vi.fn(() => ({ maybeSingle }));
  const updateEq2 = vi.fn(() => ({ select: updateSelect }));
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const update = vi.fn(() => ({ eq: updateEq1 }));

  // count chains: select(..., { head }).eq().eq() resolves to total, but when
  // followed by .lte() it resolves to due.
  const lte = vi.fn().mockResolvedValue(dueResult);
  const countEq2 = vi.fn(() => {
    const chain = Promise.resolve(totalResult) as Promise<CountResult> & { lte: typeof lte };
    chain.lte = lte;
    return chain;
  });
  const countEq1 = vi.fn(() => ({ eq: countEq2 }));
  const countSelect = vi.fn(() => ({ eq: countEq1 }));

  const from = vi.fn(() => ({ update, select: countSelect }));

  const client = { from } as unknown as SupabaseClient;
  return { client, update, lte };
}

describe("renameDeck", () => {
  it("renames a deck and returns DeckDto with current counters", async () => {
    const renamedRow = { ...VALID_ROW, name: "Genetics", updated_at: "2026-06-12T11:00:00.000Z" };
    const { client, update } = makeRenameSupabase(
      { data: renamedRow, error: null },
      { count: 7, error: null },
      { count: 3, error: null },
    );

    const result = await renameDeck(client, "user-1", "deck-1", { name: "Genetics" });

    expect(update).toHaveBeenCalledWith({ name: "Genetics" });
    expect(result.deck).toEqual({
      id: "deck-1",
      name: "Genetics",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T11:00:00.000Z",
      flashcardsCount: 7,
      dueFlashcardsCount: 3,
    });
  });

  it("treats null counters as zero", async () => {
    const { client } = makeRenameSupabase(
      { data: VALID_ROW, error: null },
      { count: null, error: null },
      { count: null, error: null },
    );

    const result = await renameDeck(client, "user-1", "deck-1", { name: "Biology 101" });

    expect(result.deck.flashcardsCount).toBe(0);
    expect(result.deck.dueFlashcardsCount).toBe(0);
  });

  it("throws DECK_NOT_FOUND when no row is returned", async () => {
    const { client } = makeRenameSupabase({ data: null, error: null });

    await expect(renameDeck(client, "user-1", "deck-1", { name: "Genetics" })).rejects.toMatchObject({
      code: "DECK_NOT_FOUND",
    });
  });

  it("throws DECK_UPDATE_FAILED when the update query fails", async () => {
    const { client } = makeRenameSupabase({ data: null, error: { message: "permission denied" } });

    await expect(renameDeck(client, "user-1", "deck-1", { name: "Genetics" })).rejects.toBeInstanceOf(DeckServiceError);
    await expect(renameDeck(client, "user-1", "deck-1", { name: "Genetics" })).rejects.toMatchObject({
      code: "DECK_UPDATE_FAILED",
    });
  });

  it("throws DECK_UPDATE_FAILED when the total count query fails", async () => {
    const { client } = makeRenameSupabase(
      { data: VALID_ROW, error: null },
      { count: null, error: { message: "count failed" } },
    );

    await expect(renameDeck(client, "user-1", "deck-1", { name: "Genetics" })).rejects.toMatchObject({
      code: "DECK_UPDATE_FAILED",
    });
  });

  it("throws DECK_UPDATE_FAILED when the due count query fails", async () => {
    const { client } = makeRenameSupabase(
      { data: VALID_ROW, error: null },
      { count: 5, error: null },
      { count: null, error: { message: "due count failed" } },
    );

    await expect(renameDeck(client, "user-1", "deck-1", { name: "Genetics" })).rejects.toMatchObject({
      code: "DECK_UPDATE_FAILED",
    });
  });
});

// -----------------------------------------------------------------------------
// listDecks
// -----------------------------------------------------------------------------

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error: PostgrestLikeError | null;
}

/**
 * A chainable, awaitable Supabase query-builder stub. Every chain method
 * (`select`, `eq`, `ilike`, `or`, `order`, `in`, `limit`) returns the same
 * builder, and awaiting the builder at any point resolves to `result`.
 */
function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "ilike", "or", "order", "in", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Build a mock for the three query chains used by `listDecks`, in call order:
 *   1. main decks query   → `from("decks")` (1st)
 *   2. flashcards counters → `from("flashcards")`
 *   3. total deck count    → `from("decks")` (2nd)
 */
function makeListSupabase(
  decksResult: QueryResult,
  flashcardsResult: QueryResult = { data: [], error: null },
  countResult: QueryResult = { count: 0, error: null },
) {
  const decksBuilder = makeBuilder(decksResult);
  const flashcardsBuilder = makeBuilder(flashcardsResult);
  const countBuilder = makeBuilder(countResult);

  let deckCall = 0;
  const from = vi.fn((table: string) => {
    if (table === "flashcards") {
      return flashcardsBuilder;
    }
    deckCall += 1;
    return deckCall === 1 ? decksBuilder : countBuilder;
  });

  const client = { from } as unknown as SupabaseClient;
  return { client, decksBuilder, flashcardsBuilder, countBuilder, from };
}

const DEFAULT_QUERY: ListDecksInput = { limit: 20, sort: "createdAt", order: "desc" };

const DECK_ROW_A = {
  id: "deck-a",
  name: "Biology 101",
  created_at: "2026-06-10T10:00:00.000Z",
  updated_at: "2026-06-10T10:00:00.000Z",
};
const DECK_ROW_B = {
  id: "deck-b",
  name: "Chemistry",
  created_at: "2026-06-11T10:00:00.000Z",
  updated_at: "2026-06-11T10:00:00.000Z",
};

describe("listDecks", () => {
  it("returns decks with merged counters, no next page, and limits", async () => {
    const { client, decksBuilder } = makeListSupabase(
      { data: [DECK_ROW_A, DECK_ROW_B], error: null },
      {
        data: [
          { deck_id: "deck-a", due_at: "2020-01-01" }, // due (past)
          { deck_id: "deck-a", due_at: "2999-01-01" }, // not due (future)
          { deck_id: "deck-b", due_at: "2020-01-01" }, // due (past)
        ],
        error: null,
      },
      { count: 2, error: null },
    );

    const result = await listDecks(client, "user-1", DEFAULT_QUERY);

    expect(result.data).toEqual([
      {
        id: "deck-a",
        name: "Biology 101",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        flashcardsCount: 2,
        dueFlashcardsCount: 1,
      },
      {
        id: "deck-b",
        name: "Chemistry",
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
        flashcardsCount: 1,
        dueFlashcardsCount: 1,
      },
    ]);
    expect(result.pagination).toEqual({ nextCursor: null, hasMore: false });
    expect(result.limits).toEqual({ deckCount: 2, deckLimit: DECK_LIMIT, canCreateDeck: true });

    // Default ordering: sort column desc, then id desc, fetching limit + 1 rows.
    expect(decksBuilder.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(decksBuilder.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(decksBuilder.limit).toHaveBeenCalledWith(21);
  });

  it("sets hasMore and encodes a usable nextCursor when an extra row exists", async () => {
    const { client } = makeListSupabase(
      { data: [DECK_ROW_A, DECK_ROW_B], error: null }, // 2 rows for limit 1 → extra row
      { data: [], error: null },
      { count: 2, error: null },
    );

    const result = await listDecks(client, "user-1", { limit: 1, sort: "createdAt", order: "desc" });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("deck-a");
    expect(result.pagination.hasMore).toBe(true);
    expect(result.pagination.nextCursor).toBeTypeOf("string");

    // The cursor must decode to the last returned row's keyset anchor.
    const decoded = JSON.parse(Buffer.from(result.pagination.nextCursor ?? "", "base64").toString("utf8")) as {
      sort: string;
      order: string;
      value: string;
      id: string;
    };
    expect(decoded).toEqual({
      sort: "createdAt",
      order: "desc",
      value: DECK_ROW_A.created_at,
      id: "deck-a",
    });
  });

  it("applies a case-insensitive search filter", async () => {
    const { client, decksBuilder } = makeListSupabase({ data: [], error: null });

    await listDecks(client, "user-1", { ...DEFAULT_QUERY, search: "bio" });

    expect(decksBuilder.ilike).toHaveBeenCalledWith("name", "%bio%");
  });

  it("applies the keyset predicate derived from a valid cursor", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ sort: "createdAt", order: "desc", value: DECK_ROW_A.created_at, id: "deck-a" }),
      "utf8",
    ).toString("base64");

    const { client, decksBuilder } = makeListSupabase({ data: [], error: null });

    await listDecks(client, "user-1", { ...DEFAULT_QUERY, cursor });

    expect(decksBuilder.or).toHaveBeenCalledWith(
      `created_at.lt.${DECK_ROW_A.created_at},and(created_at.eq.${DECK_ROW_A.created_at},id.lt.deck-a)`,
    );
  });

  it("throws INVALID_QUERY for a malformed cursor", async () => {
    const { client } = makeListSupabase({ data: [], error: null });

    await expect(listDecks(client, "user-1", { ...DEFAULT_QUERY, cursor: "%%%not-base64-json" })).rejects.toMatchObject(
      { code: "INVALID_QUERY" },
    );
  });

  it("throws INVALID_QUERY when the cursor's sort/order does not match the query", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ sort: "name", order: "asc", value: "x", id: "deck-a" }),
      "utf8",
    ).toString("base64");

    const { client } = makeListSupabase({ data: [], error: null });

    await expect(listDecks(client, "user-1", { ...DEFAULT_QUERY, cursor })).rejects.toMatchObject({
      code: "INVALID_QUERY",
    });
  });

  it("throws DECK_LIST_FAILED when the main query fails", async () => {
    const { client } = makeListSupabase({ data: null, error: { message: "select failed" } });

    await expect(listDecks(client, "user-1", DEFAULT_QUERY)).rejects.toMatchObject({ code: "DECK_LIST_FAILED" });
  });

  it("throws DECK_LIST_FAILED when the counters aggregate fails", async () => {
    const { client } = makeListSupabase(
      { data: [DECK_ROW_A], error: null },
      { data: null, error: { message: "aggregate failed" } },
    );

    await expect(listDecks(client, "user-1", DEFAULT_QUERY)).rejects.toMatchObject({ code: "DECK_LIST_FAILED" });
  });

  it("throws DECK_LIST_FAILED when the total count query fails", async () => {
    const { client } = makeListSupabase(
      { data: [DECK_ROW_A], error: null },
      { data: [], error: null },
      { count: null, error: { message: "count failed" } },
    );

    await expect(listDecks(client, "user-1", DEFAULT_QUERY)).rejects.toMatchObject({ code: "DECK_LIST_FAILED" });
  });

  it("reports canCreateDeck=false at the deck limit", async () => {
    const { client } = makeListSupabase(
      { data: [], error: null },
      { data: [], error: null },
      { count: DECK_LIMIT, error: null },
    );

    const result = await listDecks(client, "user-1", DEFAULT_QUERY);

    expect(result.limits.canCreateDeck).toBe(false);
    expect(result.limits.deckCount).toBe(DECK_LIMIT);
  });
});

// -----------------------------------------------------------------------------
// deleteDeck
// -----------------------------------------------------------------------------

interface DeleteResult {
  data: unknown;
  error: PostgrestLikeError | null;
}

/**
 * Build a mock that mimics the single query chain used by `deleteDeck`:
 *   - delete: `.from().delete().eq().eq().select()`
 *
 * The final `.select("id")` resolves to the configured result.
 */
function makeDeleteSupabase(deleteResult: DeleteResult) {
  const select = vi.fn().mockResolvedValue(deleteResult);
  const deleteEq2 = vi.fn(() => ({ select }));
  const deleteEq1 = vi.fn(() => ({ eq: deleteEq2 }));
  const del = vi.fn(() => ({ eq: deleteEq1 }));

  const from = vi.fn(() => ({ delete: del }));

  const client = { from } as unknown as SupabaseClient;
  return { client, del, deleteEq1, deleteEq2 };
}

describe("deleteDeck", () => {
  it("deletes an owned deck scoped by id and user_id", async () => {
    const { client, del, deleteEq1, deleteEq2 } = makeDeleteSupabase({ data: [{ id: "deck-1" }], error: null });

    await expect(deleteDeck(client, "user-1", "deck-1")).resolves.toBeUndefined();

    expect(del).toHaveBeenCalledTimes(1);
    expect(deleteEq1).toHaveBeenCalledWith("id", "deck-1");
    expect(deleteEq2).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("throws DECK_NOT_FOUND when no row is deleted", async () => {
    const { client } = makeDeleteSupabase({ data: [], error: null });

    await expect(deleteDeck(client, "user-1", "deck-1")).rejects.toBeInstanceOf(DeckServiceError);
    await expect(deleteDeck(client, "user-1", "deck-1")).rejects.toMatchObject({ code: "DECK_NOT_FOUND" });
  });

  it("throws DECK_DELETE_FAILED when the delete query fails", async () => {
    const { client } = makeDeleteSupabase({ data: null, error: { message: "permission denied" } });

    await expect(deleteDeck(client, "user-1", "deck-1")).rejects.toBeInstanceOf(DeckServiceError);
    await expect(deleteDeck(client, "user-1", "deck-1")).rejects.toMatchObject({ code: "DECK_DELETE_FAILED" });
  });
});
