import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const clientFactory = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: clientFactory,
}));

import { createSupabaseRouteClient } from "@/lib/auth/route-client";

describe("per-request auth client", () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  beforeAll(() => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";
    clientFactory.mockImplementation((_url, _key, options) => ({
      syntheticCookieWriter: options.cookies.setAll,
    }));
  });

  afterAll(() => {
    process.env.SUPABASE_URL = oldUrl;
    process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  });

  it("isolates cookie state across parallel request contexts", async () => {
    const first = createSupabaseRouteClient(
      new NextRequest("http://localhost/api/feed"),
    );
    const second = createSupabaseRouteClient(
      new NextRequest("http://localhost/api/feed"),
    );
    expect(clientFactory).toHaveBeenCalledTimes(2);

    await Promise.all([
      Promise.resolve().then(() =>
        (
          first.supabase as unknown as {
            syntheticCookieWriter: (
              cookies: Array<{
                name: string;
                value: string;
                options: Record<string, unknown>;
              }>,
              headers: Record<string, string>,
            ) => void;
          }
        ).syntheticCookieWriter(
          [{ name: "first", value: "one", options: {} }],
          {},
        ),
      ),
      Promise.resolve().then(() =>
        (
          second.supabase as unknown as {
            syntheticCookieWriter: (
              cookies: Array<{
                name: string;
                value: string;
                options: Record<string, unknown>;
              }>,
              headers: Record<string, string>,
            ) => void;
          }
        ).syntheticCookieWriter(
          [{ name: "second", value: "two", options: {} }],
          {},
        ),
      ),
    ]);

    const firstResponse = first.applyAuthState(NextResponse.json({ ok: true }));
    const secondResponse = second.applyAuthState(
      NextResponse.json({ ok: true }),
    );
    expect(firstResponse.cookies.get("first")?.value).toBe("one");
    expect(firstResponse.cookies.get("second")).toBeUndefined();
    expect(secondResponse.cookies.get("second")?.value).toBe("two");
    expect(secondResponse.cookies.get("first")).toBeUndefined();
    expect(firstResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(firstResponse.headers.get("set-cookie")).toContain("SameSite=lax");
  });
});
