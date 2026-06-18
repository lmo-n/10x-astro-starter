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

import { GET } from "./callback";

const exchangeCodeForSessionMock = vi.fn();

interface ContextOptions {
  url?: string;
}

function makeContext(options: ContextOptions = {}): APIContext {
  const { url = "https://app.example.com/api/auth/callback?code=abc&redirectTo=/dashboard" } = options;

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

const FAKE_SUPABASE = { auth: { exchangeCodeForSession: exchangeCodeForSessionMock } };

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockReturnValue(FAKE_SUPABASE);
  exchangeCodeForSessionMock.mockResolvedValue({ error: null });
});

describe("GET /api/auth/callback", () => {
  it("redirects to the validated redirectTo on success", async () => {
    const response = await GET(
      makeContext({ url: "https://app.example.com/api/auth/callback?code=abc&redirectTo=/decks" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/decks");
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("abc");
  });

  it("defaults to /dashboard when redirectTo is omitted", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/auth/callback?code=abc" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
  });

  it("falls back to /dashboard for an unsafe redirectTo", async () => {
    const response = await GET(
      makeContext({ url: "https://app.example.com/api/auth/callback?code=abc&redirectTo=https://evil.example.com" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
  });

  it("redirects to the sign-in page when the provider reports an error", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/auth/callback?error=access_denied" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/auth\/signin\?error=/);
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("redirects to the sign-in page when no code is present", async () => {
    const response = await GET(makeContext({ url: "https://app.example.com/api/auth/callback" }));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/auth\/signin\?error=/);
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("redirects to the sign-in page when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);

    const response = await GET(makeContext());

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/auth\/signin\?error=/);
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("redirects to the sign-in page when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: { message: "bad code" } });

    const response = await GET(makeContext());

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/auth\/signin\?error=/);
  });
});
