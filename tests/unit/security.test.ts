import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { safeRedirectDestination } from "@/lib/auth/redirects";
import { assertCsrf, assertSameOrigin } from "@/lib/security/csrf";
import { safeErrorMessage } from "@/lib/security/safe-errors";

function request(overrides: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/entries", {
    method: "POST",
    headers: {
      cookie: "odiina_csrf=known-token",
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      ...overrides,
    },
  });
}

describe("request security helpers", () => {
  beforeEach(() => {
    vi.stubEnv("ODIINA_APP_URL", "http://localhost");
  });

  it("accepts a same-origin double-submit token", () => {
    expect(() => assertCsrf(request(), "known-token")).not.toThrow();
  });

  it("rejects a cross-site origin", () => {
    expect(() =>
      assertSameOrigin(
        request({
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toThrow("csrf_origin_rejected");
  });

  it("rejects a spoofed Host and Origin pair outside the configured origin", () => {
    expect(() =>
      assertSameOrigin(
        new NextRequest("https://attacker.example/api/entries", {
          method: "POST",
          headers: {
            host: "attacker.example",
            origin: "https://attacker.example",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toThrow("csrf_origin_rejected");
  });

  it("rejects a missing or mismatched token", () => {
    expect(() => assertCsrf(request(), "wrong-token")).toThrow(
      "csrf_token_rejected",
    );
  });

  it.each([
    "https://attacker.example",
    "//attacker.example/feed",
    "/not-allowlisted",
    "/entries/not-a-uuid",
  ])("rejects open or unapproved redirects", (candidate) => {
    expect(safeRedirectDestination(candidate)).toBe("/feed");
  });

  it("does not expose unknown database messages", () => {
    expect(safeErrorMessage("password=secret unexpected")).toBe(
      "Odiina could not complete that request. Try again.",
    );
    expect(safeErrorMessage("odiina_revision_conflict")).toContain(
      "changed in another request",
    );
  });
});
