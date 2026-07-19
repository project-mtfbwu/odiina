import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getApplicationUrl } from "@/lib/environment";

function equalTokens(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function assertSameOrigin(request: NextRequest): void {
  const requestUrl = new URL(request.url);
  const allowedUrl = getApplicationUrl();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite === "cross-site") {
    throw new Error("csrf_origin_rejected");
  }

  if (
    requestUrl.origin !== allowedUrl.origin ||
    !origin ||
    new URL(origin).origin !== allowedUrl.origin
  ) {
    throw new Error("csrf_origin_rejected");
  }

  if (!host || host !== allowedUrl.host) {
    throw new Error("csrf_host_rejected");
  }
}

export function assertCsrf(request: NextRequest, submittedToken: string): void {
  assertSameOrigin(request);
  const cookieToken = request.cookies.get(csrfCookieName)?.value;
  if (
    !cookieToken ||
    !submittedToken ||
    !equalTokens(cookieToken, submittedToken)
  ) {
    throw new Error("csrf_token_rejected");
  }
}
