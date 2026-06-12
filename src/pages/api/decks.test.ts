import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { CreateDeckResponseDto, ListDecksResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `DeckServiceError` is kept real so
// `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const createDeckMock = vi.fn();
const listDecksMock = vi.fn();
vi.mock("@/lib/services/deck.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/deck.service")>("@/lib/services/deck.service");
  return {
    ...actual,
    createDeck: (...args: unknown[]): unknown => createDeckMock(...args) as unknown,
    listDecks: (...args: unknown[]): unknown => listDecksMock(...args) as unknown,
  };
});

import { GET, POST } from "./decks";
import { DeckServiceError } from "@/lib/services/deck.service";

interface ContextOptions {
  user?: { id: string } | null;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const { user = { id: "user-1" }, body, rawBody, origin, url = "https://app.example.com/api/decks" } = options;

  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) {
    headers.set("Origin", origin);
  }

  const request = {
    headers,
    url,
    json: () => {
      if (rawBody !== undefined) {
        return Promise.resolve(JSON.parse(rawBody) as unknown);
      }
      return Promise.resolve(body);
    },
  } as unknown as Request;

  return {
    request,
    cookies: {} as APIContext["cookies"],
    locals: { user },
  } as unknown as APIContext;
}

const FAKE_SUPABASE = { from: vi.fn() };

/** Read and type-narrow an error envelope response body. */
async function readError(response: Response): Promise<{ error: { code: string; message: string } }> {
  return (await response.json()) as { error: { code: string; message: string } };
}

const SUCCESS_RESULT: CreateDeckResponseDto = {
  deck: {
    id: "deck-1",
    name: "Biology 101",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    flashcardsCount: 0,
    dueFlashcardsCount: 0,
  },
  limits: { deckCount: 1, deckLimit: 120, canCreateDeck: true },
};

const LIST_SUCCESS_RESULT: ListDecksResponseDto = {
  data: [
    {
      id: "deck-1",
      name: "Biology 101",
      createdAt: "2026-06-12T10:00:00.000Z",
      updatedAt: "2026-06-12T10:00:00.000Z",
      flashcardsCount: 3,
      dueFlashcardsCount: 1,
    },
  ],
  pagination: { nextCursor: null, hasMore: false },
  limits: { deckCount: 1, deckLimit: 120, canCreateDeck: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  createDeckMock.mockResolvedValue(SUCCESS_RESULT);
  listDecksMock.mockResolvedValue(LIST_SUCCESS_RESULT);
});

describe("POST /api/decks", () => {
  it("returns 201 with the created deck on success", async () => {
    const response = await POST(makeContext({ body: { name: "Biology 101" } }));

    expect(response.status).toBe(201);
    const json = (await response.json()) as CreateDeckResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
    expect(createDeckMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", { name: "Biology 101" });
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await POST(makeContext({ user: null, body: { name: "Biology 101" } }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(createDeckMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await POST(makeContext({ body: { name: "Biology 101" }, origin: "https://evil.example.com" }));

    expect(response.status).toBe(403);
    const json = await readError(response);
    expect(json.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows a matching same-origin request", async () => {
    const response = await POST(makeContext({ body: { name: "Biology 101" }, origin: "https://app.example.com" }));

    expect(response.status).toBe(201);
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await POST(makeContext({ body: { name: "Biology 101" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
  });

  it("returns 400 INVALID_BODY when the body is not valid JSON", async () => {
    const response = await POST(makeContext({ rawBody: "not-json{" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_DECK_NAME for an empty name", async () => {
    const response = await POST(makeContext({ body: { name: "   " } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_NAME");
    expect(createDeckMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_DECK_NAME when unknown fields are present", async () => {
    const response = await POST(makeContext({ body: { name: "Math", user_id: "hacker" } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_NAME");
  });

  it("returns 409 DECK_LIMIT_REACHED when the service signals the limit", async () => {
    createDeckMock.mockRejectedValue(new DeckServiceError("DECK_LIMIT_REACHED", "limit"));

    const response = await POST(makeContext({ body: { name: "Biology 101" } }));

    expect(response.status).toBe(409);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_LIMIT_REACHED");
  });

  it("returns 500 DECK_CREATE_FAILED on a generic service failure", async () => {
    createDeckMock.mockRejectedValue(new DeckServiceError("DECK_CREATE_FAILED", "boom"));

    const response = await POST(makeContext({ body: { name: "Biology 101" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_CREATE_FAILED");
  });

  it("returns 500 DECK_CREATE_FAILED on an unexpected error", async () => {
    createDeckMock.mockRejectedValue(new Error("unexpected"));

    const response = await POST(makeContext({ body: { name: "Biology 101" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_CREATE_FAILED");
  });
});

describe("GET /api/decks", () => {
  it("returns 200 with the deck list on success", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/decks" }));

    expect(response.status).toBe(200);
    const json = (await response.json()) as ListDecksResponseDto;
    expect(json).toEqual(LIST_SUCCESS_RESULT);
  });

  it("parses and forwards validated/defaulted query parameters", async () => {
    await GET(makeContext({ url: "https://app.example.com/api/decks?limit=5&sort=name&order=asc&search=bio" }));

    expect(listDecksMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      limit: 5,
      sort: "name",
      order: "asc",
      search: "bio",
    });
  });

  it("applies defaults when no query parameters are provided", async () => {
    await GET(makeContext({ url: "https://app.example.com/api/decks" }));

    expect(listDecksMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      limit: 20,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("ignores unknown query parameters", async () => {
    await GET(makeContext({ url: "https://app.example.com/api/decks?foo=bar&limit=10" }));

    expect(listDecksMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      limit: 10,
      sort: "createdAt",
      order: "desc",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await GET(makeContext({ user: null }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(listDecksMock).not.toHaveBeenCalled();
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
  });

  it("returns 400 INVALID_QUERY for an out-of-range limit", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/decks?limit=0" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
    expect(listDecksMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_QUERY for a non-whitelisted sort value", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/decks?sort=secret_column" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
  });

  it("returns 400 INVALID_QUERY when the service rejects the cursor", async () => {
    listDecksMock.mockRejectedValue(new DeckServiceError("INVALID_QUERY", "Invalid pagination cursor."));

    const response = await GET(makeContext({ url: "https://app.example.com/api/decks?cursor=bad" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
  });

  it("returns 500 DECK_LIST_FAILED on a generic service failure", async () => {
    listDecksMock.mockRejectedValue(new DeckServiceError("DECK_LIST_FAILED", "boom"));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_LIST_FAILED");
  });

  it("returns 500 DECK_LIST_FAILED on an unexpected error", async () => {
    listDecksMock.mockRejectedValue(new Error("unexpected"));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_LIST_FAILED");
  });
});
