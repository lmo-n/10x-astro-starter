import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

// --- Mocks -------------------------------------------------------------------
// `@/lib/supabase` pulls in `astro:env/server`, a virtual module unavailable in
// the Vitest runtime, so it must be mocked. The Supabase auth client is faked so
// the route's orchestration/redirect logic can be tested in isolation.
const createClientMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createClient: (...args: unknown[]): unknown => createClientMock(...args) as unknown,
}));

import { GET } from "./google";

const signInWithOAuthMock = vi.fn();

interface ContextOptions {
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const { url = "https://app.example.com/api/auth/google" } = options;

  const request = {
    headers: new Headers(),
    url,
  } as unknown as Request;

  const redirect = (location: string, status?: number): Response =>
    new Response(null, { status: status ?? 302, headers: { Location: location } });

  return {
    request,
    url: new URL(url),
    cookies: {} as APIContext["cookies"],
    redirect,
  } as unknown as APIContext;
}

const FAKE_SUPABASE = { auth: { signInWithOAuth: signInWithOAuthMock } };

/** Read and type-narrow an error envelope response body. */
async function readError(response: Response): Promise<{ error: { code: string; message: string } }> {
  return (await response.json()) as { error: { code: string; message: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  signInWithOAuthMock.mockResolvedValue({
    data: { url: "https://accounts.google.com/o/oauth2/auth?client_id=abc" },
    error: null,
  });
});

describe("GET /api/auth/google", () => {
  it("redirects (302) to the provider URL on success", async () => {
    const response = await GET(makeContext());

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://accounts.google.com/o/oauth2/auth?client_id=abc");
  });

  it("passes the app callback URL with the default redirectTo to Supabase", async () => {
    await GET(makeContext());

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://app.example.com/api/auth/callback?redirectTo=%2Fdashboard" },
    });
  });

  it("forwards a safe redirectTo query parameter to the callback URL", async () => {
    await GET(makeContext({ url: "https://app.example.com/api/auth/google?redirectTo=/decks" }));

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://app.example.com/api/auth/callback?redirectTo=%2Fdecks" },
    });
  });

  it("returns 500 CONFIG_ERROR when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("CONFIG_ERROR");
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_REDIRECT for an absolute redirectTo", async () => {
    const response = await GET(
      makeContext({ url: "https://app.example.com/api/auth/google?redirectTo=https://evil.example.com" }),
    );

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_REDIRECT");
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_REDIRECT for a protocol-relative redirectTo", async () => {
    const response = await GET(
      makeContext({ url: "https://app.example.com/api/auth/google?redirectTo=//evil.example.com" }),
    );

    expect(response.status).toBe(400);
    const json = await readError(response);
    expect(json.error.code).toBe("INVALID_REDIRECT");
  });

  it("returns 500 OAUTH_START_FAILED when Supabase returns an error", async () => {
    signInWithOAuthMock.mockResolvedValue({ data: { url: null }, error: { message: "boom" } });

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("OAUTH_START_FAILED");
  });

  it("returns 500 OAUTH_START_FAILED when no provider URL is returned", async () => {
    signInWithOAuthMock.mockResolvedValue({ data: { url: null }, error: null });

    const response = await GET(makeContext());

    expect(response.status).toBe(500);
    const json = await readError(response);
    expect(json.error.code).toBe("OAUTH_START_FAILED");
  });
});
