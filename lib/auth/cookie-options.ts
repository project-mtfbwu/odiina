import type { CookieOptions } from "@supabase/ssr";

export const authCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const csrfCookieName = "odiina_csrf";

export const csrfCookieOptions = {
  ...authCookieOptions,
  maxAge: 60 * 60 * 8,
} as const;

export function forceHttpOnly(options: CookieOptions): CookieOptions {
  return {
    ...options,
    ...authCookieOptions,
  };
}
