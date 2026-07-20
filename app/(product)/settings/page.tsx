import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PreferencesForm } from "@/components/preferences-form";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getPreferences } from "@/lib/database/queries";
import { featureFlags } from "@/lib/feature-flags";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [preferences, cookieStore] = await Promise.all([
    getPreferences(),
    cookies(),
  ]);
  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";

  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">
            Control how Odiina interprets civil days. Your private data remains
            in the local Supabase environment during this implementation phase.
          </p>
        </div>
      </header>

      <section className="panel p-5 sm:p-7" aria-labelledby="time-heading">
        <h2 id="time-heading" className="mt-0 text-xl font-bold">
          Time and week
        </h2>
        <PreferencesForm
          initialTimezone={preferences.iana_timezone}
          initialWeekStartsOn={preferences.week_starts_on}
          csrfToken={csrf}
        />
      </section>

      <section className="panel mt-4 p-5 sm:p-7" aria-labelledby="beta-heading">
        <h2 id="beta-heading" className="mt-0 text-xl font-bold">
          Private-beta data status
        </h2>
        <p className="leading-7 text-[var(--muted)]">
          Private image capture and its safety worker are enabled. AI, voice,
          video, location, sharing and period reports remain gated behind their
          mandatory MVP stages. Odiina does not call OpenAI or use third-party
          analytics in this increment.
        </p>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(featureFlags).map(([name, enabled]) => (
            <div
              className="flex items-center justify-between rounded-xl bg-[var(--surface-raised)] px-4 py-3"
              key={name}
            >
              <dt className="font-semibold capitalize">{name}</dt>
              <dd className="m-0 font-bold text-[var(--muted)]">
                {enabled ? "Enabled" : "Disabled"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="panel mt-4 p-5 sm:p-7"
        aria-labelledby="session-heading"
      >
        <h2 id="session-heading" className="mt-0 text-xl font-bold">
          Session
        </h2>
        <p className="leading-7 text-[var(--muted)]">
          Logging out clears the Odiina session on this browser.
        </p>
        <form action="/auth/logout" method="post">
          <input type="hidden" name="csrf" value={csrf} />
          <button className="button button-secondary" type="submit">
            Log out of Odiina
          </button>
        </form>
      </section>
    </div>
  );
}
