import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { GetStudyDueResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `StudyServiceError` is kept real so
// `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const getDueStudyQueueMock = vi.fn();
vi.mock("@/lib/services/study.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/study.service")>("@/lib/services/study.service");
  return {
    ...actual,
    getDueStudyQueue: (...args: unknown[]): unknown => getDueStudyQueueMock(...args) as unknown,
  };
});

import { GET } from "./due";
import { StudyServiceError } from "@/lib/services/study.service";

interface ContextOptions {
  user?: { id: string } | null;
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const { user = { id: "user-1" }, url = "https://app.example.com/api/study/due" } = options;

  const request = {
    headers: new Headers(),
    url,
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

const SUCCESS_RESULT: GetStudyDueResponseDto = {
  data: [
    {
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
    },
  ],
  pagination: { nextCursor: null, hasMore: false },
  summary: { dueCount: 1, suggestedTodayCount: 1, upcomingCount: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  getDueStudyQueueMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("GET /api/study/due", () => {
  it("returns 200 with the due study queue on success", async () => {
    const response = await GET(makeContext());

    expect(response.status).toBe(200);
    const json = (await response.json()) as GetStudyDueResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
  });

  it("applies defaults when no query parameters are provided", async () => {
    await GET(makeContext());

    expect(getDueStudyQueueMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      limit: 20,
      includeFuturePreview: false,
    });
  });

  it("parses and forwards validated query parameters", async () => {
    await GET(
      makeContext({
        url: "https://app.example.com/api/study/due?deckId=11111111-1111-4111-8111-111111111111&limit=5&cursor=abc&includeFuturePreview=true",
      }),
    );

    expect(getDueStudyQueueMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      deckId: "11111111-1111-4111-8111-111111111111",
      limit: 5,
      cursor: "abc",
      includeFuturePreview: true,
    });
  });

  it("ignores unknown query parameters", async () => {
    await GET(makeContext({ url: "https://app.example.com/api/study/due?foo=bar&limit=10" }));

    expect(getDueStudyQueueMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", {
      limit: 10,
      includeFuturePreview: false,
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await GET(makeContext({ user: null }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(getDueStudyQueueMock).not.toHaveBeenCalled();
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(getDueStudyQueueMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_QUERY for an out-of-range limit", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/study/due?limit=0" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
    expect(getDueStudyQueueMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_QUERY for an invalid deckId", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/study/due?deckId=not-a-uuid" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
    expect(getDueStudyQueueMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_QUERY for a non-boolean includeFuturePreview", async () => {
    const response = await GET(
      makeContext({ url: "https://app.example.com/api/study/due?includeFuturePreview=maybe" }),
    );

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
  });

  it("returns 404 DECK_NOT_FOUND when the service rejects a foreign deck", async () => {
    getDueStudyQueueMock.mockRejectedValue(new StudyServiceError("DECK_NOT_FOUND", "Deck not found."));

    const response = await GET(
      makeContext({ url: "https://app.example.com/api/study/due?deckId=11111111-1111-4111-8111-111111111111" }),
    );

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("DECK_NOT_FOUND");
  });

  it("returns 400 INVALID_QUERY when the service rejects the cursor", async () => {
    getDueStudyQueueMock.mockRejectedValue(new StudyServiceError("INVALID_QUERY", "Invalid pagination cursor."));

    const response = await GET(makeContext({ url: "https://app.example.com/api/study/due?cursor=bad" }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_QUERY");
  });

  it("returns 500 STUDY_QUEUE_FAILED on a generic service failure", async () => {
    getDueStudyQueueMock.mockRejectedValue(new StudyServiceError("STUDY_QUEUE_FAILED", "boom"));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("STUDY_QUEUE_FAILED");
  });

  it("returns 500 STUDY_QUEUE_FAILED on an unexpected error", async () => {
    getDueStudyQueueMock.mockRejectedValue(new Error("unexpected"));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("STUDY_QUEUE_FAILED");
  });
});
