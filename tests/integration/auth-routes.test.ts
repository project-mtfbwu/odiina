import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getClaims: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth/route-client", () => ({
  createSupabaseRouteClient: () => ({
    supabase: { auth: authMocks },
    applyAuthState: <T extends NextResponse>(response: T) => {
      response.headers.set(
        "Cache-Control",
        "private, no-store, max-age=0, must-revalidate",
      );
      return response;
    },
  }),
}));

import { GET as callback } from "@/app/auth/callback/route";
import { POST as login } from "@/app/auth/login/route";
import { POST as logout } from "@/app/auth/logout/route";

function formRequest(
  path: string,
  values: Record<string, string>,
): NextRequest {
  const body = new FormData();
  for (const [name, value] of Object.entries(values)) {
    body.set(name, value);
  }
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: {
      cookie: "odiina_csrf=known-token",
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
  });
}

describe("authentication routes", () => {
  beforeEach(() => {
    vi.stubEnv("ODIINA_APP_URL", "http://localhost");
    vi.clearAllMocks();
    authMocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    authMocks.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: null,
    });
    authMocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-id" } },
      error: null,
    });
    authMocks.signOut.mockResolvedValue({ error: null });
  });

  it.each([
    ["eligible", null],
    ["ineligible", { message: "User not found" }],
  ])(
    "returns the same generic login response for an %s address",
    async (_kind, providerError) => {
      authMocks.signInWithOtp.mockResolvedValueOnce({
        data: {},
        error: providerError,
      });
      const response = await login(
        formRequest("/auth/login", {
          csrf: "known-token",
          email: "person@example.test",
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "http://localhost/login?status=check-email",
      );
    },
  );

  it("rejects login CSRF before contacting Auth", async () => {
    const response = await login(
      formRequest("/auth/login", {
        csrf: "wrong-token",
        email: "person@example.test",
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/login?error=request");
    expect(authMocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("accepts a callback only after exchange and verified claims", async () => {
    const response = await callback(
      new NextRequest(
        "http://localhost/auth/callback?code=valid&next=/settings",
      ),
    );
    expect(authMocks.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(authMocks.getClaims).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost/settings");
  });

  it.each([
    ["missing", "http://localhost/auth/callback"],
    ["expired", "http://localhost/auth/callback?code=expired"],
  ])("fails a %s magic link safely", async (kind, url) => {
    if (kind === "expired") {
      authMocks.exchangeCodeForSession.mockResolvedValueOnce({
        data: {},
        error: { message: "expired" },
      });
    }
    const response = await callback(new NextRequest(url));
    expect(response.headers.get("location")).toContain(
      "/login?error=invalid-link",
    );
  });

  it("rejects an open redirect after a valid callback", async () => {
    const response = await callback(
      new NextRequest(
        "http://localhost/auth/callback?code=valid&next=https://attacker.example",
      ),
    );
    expect(response.headers.get("location")).toBe("http://localhost/feed");
  });

  it("logs out locally and returns a no-store response", async () => {
    const response = await logout(
      formRequest("/auth/logout", { csrf: "known-token" }),
    );
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
