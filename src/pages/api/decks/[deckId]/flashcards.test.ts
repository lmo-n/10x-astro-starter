import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { CreateFlashcardResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `FlashcardServiceError` is kept
// real so `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const createManualFlashcardMock = vi.fn();
vi.mock("@/lib/services/flashcard.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/flashcard.service")>(
    "@/lib/services/flashcard.service",
  );
  return {
    ...actual,
    createManualFlashcard: (...args: unknown[]): unknown => createManualFlashcardMock(...args) as unknown,
  };
});

import { POST } from "./flashcards";
import { FlashcardServiceError } from "@/lib/services/flashcard.service";

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
    url = `https://app.example.com/api/decks/${VALID_DECK_ID}/flashcards`,
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

const SUCCESS_RESULT: CreateFlashcardResponseDto = {
  flashcard: {
    id: "22222222-2222-4222-8222-222222222222",
    deckId: VALID_DECK_ID,
    frontText: "What is photosynthesis?",
    backText: "The process by which plants convert light energy into chemical energy stored in glucose.",
    createdByAi: false,
    sm2: {
      interval: 0,
      repetition: 0,
      easeFactor: 2.5,
      dueAt: "2026-06-16",
      lastReviewedAt: null,
    },
    createdAt: "2026-06-16T10:00:00.000Z",
    updatedAt: "2026-06-16T10:00:00.000Z",
  },
};

const VALID_BODY = {
  frontText: "What is photosynthesis?",
  backText: "The process by which plants convert light energy into chemical energy stored in glucose.",
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  createManualFlashcardMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("POST /api/decks/{deckId}/flashcards", () => {
  it("returns 201 with the created flashcard on success", async () => {
    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(201);
    const json = (await response.json()) as CreateFlashcardResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
    expect(createManualFlashcardMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", VALID_DECK_ID, {
      frontText: "What is photosynthesis?",
      backText: "The process by which plants convert light energy into chemical energy stored in glucose.",
    });
  });

  it("passes trimmed text to the service", async () => {
    const response = await POST(
      makeContext({ body: { frontText: "  Trimmed front  ", backText: "  Trimmed back  " } }),
    );

    expect(response.status).toBe(201);
    expect(createManualFlashcardMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", VALID_DECK_ID, {
      frontText: "Trimmed front",
      backText: "Trimmed back",
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await POST(makeContext({ user: null, body: VALID_BODY }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await POST(makeContext({ body: VALID_BODY, origin: "https://evil.example.com" }));

    expect(response.status).toBe(403);
    const json = await readError(response);
    expect(json.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("allows a matching same-origin request", async () => {
    const response = await POST(makeContext({ body: VALID_BODY, origin: "https://app.example.com" }));

    expect(response.status).toBe(201);
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_DECK_ID when deckId is not a UUID", async () => {
    const response = await POST(makeContext({ deckId: "not-a-uuid", body: VALID_BODY }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_DECK_ID");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_BODY when the body is not valid JSON", async () => {
    const response = await POST(makeContext({ rawBody: "not-json{" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_BODY");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT when frontText is missing", async () => {
    const response = await POST(makeContext({ body: { backText: "Only back text." } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_FLASHCARD_TEXT for an empty frontText", async () => {
    const response = await POST(makeContext({ body: { frontText: "   ", backText: "Some back." } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT for an overly long frontText", async () => {
    const response = await POST(makeContext({ body: { frontText: "x".repeat(501), backText: "Some back." } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT for an overly long backText", async () => {
    const response = await POST(makeContext({ body: { frontText: "Short?", backText: "x".repeat(3001) } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT for HTML-like input", async () => {
    const response = await POST(makeContext({ body: { frontText: "<b>Hi</b>", backText: "Some back." } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT when frontText has too many sentences", async () => {
    const response = await POST(makeContext({ body: { frontText: "One. Two. Three.", backText: "Some back." } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
  });

  it("returns 400 INVALID_FLASHCARD_TEXT when unknown fields are present", async () => {
    const response = await POST(makeContext({ body: { ...VALID_BODY, createdByAi: true } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_TEXT");
    expect(createManualFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 404 DECK_NOT_FOUND when the service signals a missing deck", async () => {
    createManualFlashcardMock.mockRejectedValue(new FlashcardServiceError("DECK_NOT_FOUND", "not found"));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_NOT_FOUND");
  });

  it("returns 500 FLASHCARD_CREATE_FAILED on a generic service failure", async () => {
    createManualFlashcardMock.mockRejectedValue(new FlashcardServiceError("FLASHCARD_CREATE_FAILED", "boom"));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_CREATE_FAILED");
  });

  it("returns 500 FLASHCARD_CREATE_FAILED on an unexpected error", async () => {
    createManualFlashcardMock.mockRejectedValue(new Error("unexpected"));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_CREATE_FAILED");
  });
});
