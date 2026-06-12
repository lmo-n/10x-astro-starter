import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { RenameDeckResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `DeckServiceError` is kept real so
// `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const renameDeckMock = vi.fn();
vi.mock("@/lib/services/deck.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/deck.service")>("@/lib/services/deck.service");
  return {
    ...actual,
    renameDeck: (...args: unknown[]): unknown => renameDeckMock(...args) as unknown,
  };
});

import { PATCH } from "./[deckId]";
import { DeckServiceError } from "@/lib/services/deck.service";

const VALID_DECK_ID = "11111111-1111-4111-8111-111111111111";

interface ContextOptions {
  user?: { id: string } | null;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  url?: string;
  deckId?: string | undefined;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const {
    user = { id: "user-1" },
    body,
    rawBody,
    origin,
    url = `https://app.example.com/api/decks/${VALID_DECK_ID}`,
    deckId = VALID_DECK_ID,
  } = options;

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
    params: { deckId },
  } as unknown as APIContext;
}

const FAKE_SUPABASE = { from: vi.fn() };

/** Read and type-narrow an error envelope response body. */
async function readError(response: Response): Promise<{ error: { code: string; message: string } }> {
  return (await response.json()) as { error: { code: string; message: string } };
}

const SUCCESS_RESULT: RenameDeckResponseDto = {
  deck: {
    id: VALID_DECK_ID,
    name: "Genetics",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z",
    flashcardsCount: 7,
    dueFlashcardsCount: 3,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  renameDeckMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("PATCH /api/decks/{deckId}", () => {
  it("returns 200 with the renamed deck on success", async () => {
    const response = await PATCH(makeContext({ body: { name: "Genetics" } }));

    expect(response.status).toBe(200);
    const json = (await response.json()) as RenameDeckResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
    expect(renameDeckMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", VALID_DECK_ID, { name: "Genetics" });
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await PATCH(makeContext({ user: null, body: { name: "Genetics" } }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(renameDeckMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await PATCH(makeContext({ body: { name: "Genetics" }, origin: "https://evil.example.com" }));

    expect(response.status).toBe(403);
    const json = await readError(response);
    expect(json.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows a matching same-origin request", async () => {
    const response = await PATCH(makeContext({ body: { name: "Genetics" }, origin: "https://app.example.com" }));

    expect(response.status).toBe(200);
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await PATCH(makeContext({ body: { name: "Genetics" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
  });

  it("returns 400 INVALID_DECK_ID when deckId is not a UUID", async () => {
    const response = await PATCH(makeContext({ deckId: "not-a-uuid", body: { name: "Genetics" } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_ID");
    expect(renameDeckMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_BODY when the body is not valid JSON", async () => {
    const response = await PATCH(makeContext({ rawBody: "not-json{" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_DECK_NAME for an empty name", async () => {
    const response = await PATCH(makeContext({ body: { name: "   " } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_NAME");
    expect(renameDeckMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_DECK_NAME for a too-long name", async () => {
    const response = await PATCH(makeContext({ body: { name: "x".repeat(101) } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_NAME");
  });

  it("returns 400 INVALID_DECK_NAME when unknown fields are present", async () => {
    const response = await PATCH(makeContext({ body: { name: "Genetics", user_id: "hacker" } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_NAME");
  });

  it("returns 404 DECK_NOT_FOUND when the service signals a missing deck", async () => {
    renameDeckMock.mockRejectedValue(new DeckServiceError("DECK_NOT_FOUND", "not found"));

    const response = await PATCH(makeContext({ body: { name: "Genetics" } }));

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_NOT_FOUND");
  });

  it("returns 500 DECK_UPDATE_FAILED on a generic service failure", async () => {
    renameDeckMock.mockRejectedValue(new DeckServiceError("DECK_UPDATE_FAILED", "boom"));

    const response = await PATCH(makeContext({ body: { name: "Genetics" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_UPDATE_FAILED");
  });

  it("returns 500 DECK_UPDATE_FAILED on an unexpected error", async () => {
    renameDeckMock.mockRejectedValue(new Error("unexpected"));

    const response = await PATCH(makeContext({ body: { name: "Genetics" } }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_UPDATE_FAILED");
  });
});
