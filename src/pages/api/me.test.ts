import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { GetProfileResponseDto } from "@/types";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The service is mocked to isolate the
// route's orchestration/error-mapping logic; `ProfileServiceError` is kept real
// so `instanceof` checks behave correctly.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

const getProfileMock = vi.fn();
vi.mock("@/lib/services/profile.service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/profile.service")>(
    "@/lib/services/profile.service",
  );
  return {
    ...actual,
    getProfile: (...args: unknown[]): unknown => getProfileMock(...args) as unknown,
  };
});

import { GET } from "./me";
import { ProfileServiceError } from "@/lib/services/profile.service";

interface ContextOptions {
  user?: { id: string } | null;
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const { user = { id: "user-1" }, url = "https://app.example.com/api/me" } = options;

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

const SUCCESS_RESULT: GetProfileResponseDto = {
  profile: {
    id: "user-1",
    planType: "free",
    aiCreditsLimit: 50,
    aiCreditsUsed: 12,
    aiCreditsRemaining: 38,
    aiCreditsResetDate: "2026-07-01",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-18T08:30:00.000Z",
  },
  stats: {
    deckCount: 7,
    deckLimit: 120,
    dueFlashcardsCount: 33,
    totalFlashcardsCount: 210,
    aiCreatedFlashcardsCount: 95,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  getProfileMock.mockResolvedValue(SUCCESS_RESULT);
});

describe("GET /api/me", () => {
  it("returns 200 with the profile and stats on success", async () => {
    const response = await GET(makeContext());

    expect(response.status).toBe(200);
    const json = (await response.json()) as GetProfileResponseDto;
    expect(json).toEqual(SUCCESS_RESULT);
    expect(getProfileMock).toHaveBeenCalledWith(FAKE_SUPABASE, "user-1");
  });

  it("returns 401 when the user is not authenticated", async () => {
    const response = await GET(makeContext({ user: null }));

    expect(response.status).toBe(401);
    const json = await readError(response);
    expect(json.error.code).toBe("AUTH_REQUIRED");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(getProfileMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the profile row is missing", async () => {
    getProfileMock.mockRejectedValue(new ProfileServiceError("PROFILE_NOT_FOUND", "Profile not found."));

    const response = await GET(makeContext());

    expect(response.status).toBe(404);
    const json = await readError(response);
    expect(json.error.code).toBe("PROFILE_NOT_FOUND");
  });

  it("returns 500 when the service reports a fetch failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getProfileMock.mockRejectedValue(new ProfileServiceError("PROFILE_FETCH_FAILED", "Failed to load profile."));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("PROFILE_FETCH_FAILED");
  });

  it("returns 500 on an unexpected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getProfileMock.mockRejectedValue(new Error("boom"));

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("PROFILE_FETCH_FAILED");
  });
});
