import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { SubmitReviewResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `StudyServiceError` is kept real so
// `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const submitStudyReviewMock = vi.fn();
vi.mock("@/lib/services/study.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/study.service")>("@/lib/services/study.service");
  return {
    ...actual,
    submitStudyReview: (...args: unknown[]): unknown => submitStudyReviewMock(...args) as unknown,
  };
});

import { POST } from "./reviews";
import { StudyServiceError } from "@/lib/services/study.service";

interface ContextOptions {
  user?: { id: string } | null;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const {
    user = { id: "user-1" },
    body,
    rawBody,
    origin = null,
    url = "https://app.example.com/api/study/reviews",
  } = options;

  const headers = new Headers();
  if (origin) {
    headers.set("Origin", origin);
  }

  const request = {
    headers,
    url,
    json: () => {
      if (rawBody !== undefined) {
        return Promise.resolve(JSON.parse(rawBody));
      }
      if (body === undefined) {
        return Promise.reject(new SyntaxError("Unexpected end of JSON input"));
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

const VALID_BODY = { flashcardId: "22222222-2222-4222-8222-222222222222", grade: "good" };

const SUCCESS_RESULT: SubmitReviewResponseDto = {
  flashcard: {
    id: "22222222-2222-4222-8222-222222222222",
    deckId: "11111111-1111-4111-8111-111111111111",
    frontText: "What is osmosis?",
    backText: "Movement of water across a semipermeable membrane.",
    createdByAi: false,
    sm2: {
      interval: 1,
      repetition: 1,
      easeFactor: 2.5,
      dueAt: "2026-06-18",
      lastReviewedAt: "2026-06-17",
    },
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-17T10:15:00.000Z",
  },
  nextDueCount: 33,
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  submitStudyReviewMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("POST /api/study/reviews", () => {
  it("returns 200 with the submitted review on success", async () => {
    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(200);
    const json = (await response.json()) as SubmitReviewResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
    expect(submitStudyReviewMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1", VALID_BODY);
  });

  it("allows same-origin requests", async () => {
    const response = await POST(makeContext({ body: VALID_BODY, origin: "https://app.example.com" }));

    expect(response.status).toBe(200);
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await POST(makeContext({ user: null, body: VALID_BODY }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 403 for cross-origin requests", async () => {
    const response = await POST(makeContext({ body: VALID_BODY, origin: "https://evil.example.com" }));

    expect(response.status).toBe(403);
    const json = await readError(response);
    expect(json.error.code).toBe("FORBIDDEN_ORIGIN");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_BODY when the body is not valid JSON", async () => {
    const response = await POST(makeContext({}));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_BODY");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_REVIEW_PAYLOAD for an invalid flashcardId", async () => {
    const response = await POST(makeContext({ body: { flashcardId: "not-a-uuid", grade: "good" } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_REVIEW_PAYLOAD");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_REVIEW_PAYLOAD for an invalid grade", async () => {
    const response = await POST(
      makeContext({ body: { flashcardId: "22222222-2222-4222-8222-222222222222", grade: "perfect" } }),
    );

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_REVIEW_PAYLOAD");
  });

  it("returns 400 INVALID_REVIEW_PAYLOAD for unknown body fields", async () => {
    const response = await POST(makeContext({ body: { ...VALID_BODY, sm2Interval: 99 } }));

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_REVIEW_PAYLOAD");
    expect(submitStudyReviewMock).not.toHaveBeenCalled();
  });

  it("returns 404 FLASHCARD_NOT_FOUND when the service rejects a missing card", async () => {
    submitStudyReviewMock.mockRejectedValue(new StudyServiceError("FLASHCARD_NOT_FOUND", "Flashcard not found."));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("FLASHCARD_NOT_FOUND");
  });

  it("returns 500 REVIEW_SAVE_FAILED on a generic service failure", async () => {
    submitStudyReviewMock.mockRejectedValue(new StudyServiceError("REVIEW_SAVE_FAILED", "boom"));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("REVIEW_SAVE_FAILED");
  });

  it("returns 500 REVIEW_SAVE_FAILED on an unexpected error", async () => {
    submitStudyReviewMock.mockRejectedValue(new Error("unexpected"));

    const response = await POST(makeContext({ body: VALID_BODY }));

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("REVIEW_SAVE_FAILED");
  });
});
