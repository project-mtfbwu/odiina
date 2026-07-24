import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ReportCreator } from "@/components/report-creator";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getPreferences } from "@/lib/database/queries";
import { localCivilDate } from "@/lib/validation/timezone";

export const metadata: Metadata = { title: "Create private recap" };
export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const [preferences, cookieStore] = await Promise.all([
    getPreferences(),
    cookies(),
  ]);
  const timezone = preferences.iana_timezone ?? "UTC";
  return (
    <div className="content-narrow">
      <header className="page-header">
        <div>
          <p className="eyebrow">Deterministic first</p>
          <h1 className="page-title">Create a private recap</h1>
          <p className="page-description">
            Periods use occurrence dates in {timezone}. Previewing and factual
            generation never call an AI provider.
          </p>
        </div>
      </header>
      <section
        className="panel p-5 sm:p-7"
        aria-labelledby="report-scope-heading"
      >
        <h2 id="report-scope-heading" className="mt-0">
          Choose the period
        </h2>
        <ReportCreator
          csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
          weekStartsOn={preferences.week_starts_on}
          initialDate={localCivilDate(new Date(), timezone)}
        />
      </section>
    </div>
  );
}
