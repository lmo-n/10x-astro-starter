import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `FlashcardServiceError` is kept real
// so `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const deleteFlashcardMock = vi.fn();
vi.mock("@/lib/services/flashcard.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/flashcard.service")>(
    "@/lib/services/flashcard.service",
  );
  return {
    ...actual,
    deleteFlashcard: (...args: unknown[]): unknown => deleteFlashcardMock(...args) as unknown,
  };
});

import { DELETE } from "./[flashcardId]";
import { FlashcardServiceError } from "@/lib/services/flashcard.service";

const VALID_FLASHCARD_ID = "22222222-2222-4222-8222-222222222222";

interface ContextOptions {
  user?: { id: string } | null;
  origin?: string | null;
  url?: string;
  flashcardId?: string | undefined;
  jsonImpl?: () => Promise<unknown>;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const {
    user = { id: "user-1" },
    origin,
    url = `https://app.example.com/api/flashcards/${VALID_FLASHCARD_ID}`,
    flashcardId = VALID_FLASHCARD_ID,
    jsonImpl,
  } = options;

  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) {
    headers.set("Origin", origin);
  }

  const request = {
    headers,
    url,
    // The DELETE handler must never read a body; calling this throws to assert that.
    json:
      jsonImpl ??
      ((): Promise<unknown> => {
        throw new Error("request.json() must not be called by the DELETE handler");
      }),
  } as unknown as Request;

  return {
    request,
    cookies: {} as APIContext["cookies"],
    locals: { user },
    params: { flashcardId },
  } as unknown as APIContext;
}

const FAKE_SUPABASE = { from: vi.fn() };

/** Read and type-narrow an error envelope response body. */
async function readError(response: Response): Promise<{ error: { code: string; message: string } }> {
  return (await response.json()) as { error: { code: string; message: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  deleteFlashcardMock.mockResolvedValue(undefined);
});

describe("DELETE /api/flashcards/{flashcardId}", () => {
  it("returns 200 with a success message and calls the service with (supabase, userId, flashcardId)", async () => {
    const response = await DELETE(makeContext());

    expect(response.status).toBe(200);
    const json = (await response.json()) as { message: string };
    expect(json).toEqual({ message: "Flashcard deleted successfully" });
    expect(deleteFlashcardMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", VALID_FLASHCARD_ID);
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await DELETE(makeContext({ user: null }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(deleteFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a cross-origin request", async () => {
    const response = await DELETE(makeContext({ origin: "https://evil.example.com" }));

    expect(response.status).toBe(403);
    const json = await readError(response);
    expect(json.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(deleteFlashcardMock).not.toHaveBeenCalled();
  });

  it("allows a matching same-origin request", async () => {
    const response = await DELETE(makeContext({ origin: "https://app.example.com" }));

    expect(response.status).toBe(200);
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await DELETE(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(deleteFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_FLASHCARD_ID when flashcardId is not a UUID", async () => {
    const response = await DELETE(makeContext({ flashcardId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_FLASHCARD_ID");
    expect(deleteFlashcardMock).not.toHaveBeenCalled();
  });

  it("returns 404 FLASHCARD_NOT_FOUND when the service signals a missing flashcard", async () => {
    deleteFlashcardMock.mockRejectedValue(new FlashcardServiceError("FLASHCARD_NOT_FOUND", "not found"));

    const response = await DELETE(makeContext());

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_NOT_FOUND");
  });

  it("returns 500 FLASHCARD_DELETE_FAILED on a service delete failure", async () => {
    deleteFlashcardMock.mockRejectedValue(new FlashcardServiceError("FLASHCARD_DELETE_FAILED", "boom"));

    const response = await DELETE(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_DELETE_FAILED");
  });

  it("returns 500 FLASHCARD_DELETE_FAILED on an unexpected error", async () => {
    deleteFlashcardMock.mockRejectedValue(new Error("unexpected"));

    const response = await DELETE(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_DELETE_FAILED");
  });

  it("does not attempt to parse a request body", async () => {
    const jsonImpl = vi.fn(() => Promise.resolve({}));

    await DELETE(makeContext({ jsonImpl }));

    expect(jsonImpl).not.toHaveBeenCalled();
  });
});
