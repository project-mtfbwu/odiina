const allowedDestinations = new Set([
  "/feed",
  "/onboarding",
  "/settings",
  "/trash",
]);

export function safeRedirectDestination(
  candidate: string | null | undefined,
  fallback = "/feed",
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  const url = new URL(candidate, "http://odiina.invalid");
  if (url.origin !== "http://odiina.invalid") {
    return fallback;
  }

  if (
    allowedDestinations.has(url.pathname) ||
    /^\/entries\/[0-9a-f-]{36}$/.test(url.pathname)
  ) {
    return `${url.pathname}${url.search}`;
  }

  return fallback;
}
