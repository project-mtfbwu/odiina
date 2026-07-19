import type { Metadata } from "next";
import { cookies } from "next/headers";

import { csrfCookieName } from "@/lib/auth/cookie-options";
import { hasSupabaseEnvironment } from "@/lib/environment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";
  const configured = hasSupabaseEnvironment();
  const status = typeof params.status === "string" ? params.status : null;
  const error = typeof params.error === "string" ? params.error : null;
  const reason = typeof params.reason === "string" ? params.reason : null;

  return (
    <main className="min-h-dvh bg-[var(--rail)] px-4 py-8 sm:px-8 sm:py-14">
      <div className="mx-auto grid min-h-[calc(100dvh-7rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="max-w-xl text-white">
          <p className="mb-5 text-sm font-bold tracking-[0.16em] text-[#b8aef5] uppercase">
            Private beta
          </p>
          <h1 className="m-0 text-5xl leading-[0.94] font-black tracking-[-0.065em] sm:text-7xl">
            Odiina
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-[#c7cad2] sm:text-xl">
            A private raw-life and work feed that turns your daily activity into
            traceable personal intelligence.
          </p>
          <div className="mt-10 flex items-center gap-3 text-sm text-[#9ca1ad]">
            <span className="h-px w-12 bg-[#555b69]" aria-hidden="true" />
            Capture → Interpret → Confirm → Review → Trace
          </div>
        </section>

        <section
          className="rounded-[1.4rem] bg-white p-6 shadow-2xl shadow-black/25 sm:p-9"
          aria-labelledby="login-heading"
        >
          <p className="eyebrow">Welcome back</p>
          <h2
            id="login-heading"
            className="m-0 text-3xl font-bold tracking-[-0.04em]"
          >
            Sign in to your private feed
          </h2>
          <p className="mt-3 mb-7 leading-7 text-[var(--muted)]">
            Enter your invited email. Odiina will send a secure magic link if
            the address is eligible.
          </p>

          {status === "check-email" ? (
            <div className="mb-6 rounded-xl bg-[var(--accent-soft)] p-4 text-sm leading-6 text-[#3e327e]">
              If the address is eligible, a sign-in link is on its way. The
              response is intentionally the same for every address.
            </div>
          ) : null}
          {status === "logged-out" ? (
            <div className="mb-6 rounded-xl bg-[#eaf5ef] p-4 text-sm text-[#255846]">
              You have been signed out of Odiina.
            </div>
          ) : null}
          {error ? (
            <div className="form-error mb-6" role="alert">
              {error === "invalid-link"
                ? "That sign-in link is invalid or expired. Request a new one."
                : "Odiina could not complete sign-in. Request a new link."}
            </div>
          ) : null}
          {!configured || reason === "configuration" ? (
            <div className="form-error mb-6" role="status">
              Local Supabase values are not configured yet. Copy{" "}
              <code>.env.example</code> to <code>.env.local</code> after
              starting the local stack.
            </div>
          ) : null}

          <form action="/auth/login" method="post" className="grid gap-5">
            <input type="hidden" name="csrf" value={csrf} />
            <div className="field">
              <label className="field-label" htmlFor="email">
                Email address
              </label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                placeholder="you@example.com"
                required
                disabled={!configured}
              />
            </div>
            <button
              className="button button-primary w-full"
              type="submit"
              disabled={!configured || !csrf}
            >
              Email me a magic link
            </button>
          </form>

          <p className="mt-6 mb-0 text-xs leading-5 text-[var(--muted)]">
            No password is stored by Odiina. This private beta does not use
            third-party analytics.
          </p>
        </section>
      </div>
    </main>
  );
}
