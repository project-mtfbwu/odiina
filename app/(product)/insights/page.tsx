import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { InsightGenerator } from "@/components/insight-generator";
import { getAiRuntimeStatus } from "@/lib/ai/config";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getAiSettings, getInsights } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Private insights" };
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const [settings, insights, cookieStore] = await Promise.all([
    getAiSettings(),
    getInsights(),
    cookies(),
  ]);
  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <p className="eyebrow">Evidence, not authority</p>
          <h1 className="page-title">Private insights</h1>
          <p className="page-description">
            Generate an optional summary from an explicit, previewed snapshot.
            Every retained claim links back to the accepted Entry revision used.
          </p>
        </div>
      </header>
      <section
        className="panel p-5 sm:p-7"
        aria-labelledby="generate-insight-heading"
      >
        <h2 id="generate-insight-heading" className="mt-0 text-xl font-bold">
          New insight
        </h2>
        <InsightGenerator
          settings={settings}
          providerAvailable={getAiRuntimeStatus().providerAvailable}
          csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
        />
      </section>
      <section
        className="panel mt-4 p-5 sm:p-7"
        aria-labelledby="saved-insights-heading"
      >
        <h2 id="saved-insights-heading" className="mt-0 text-xl font-bold">
          Saved insights
        </h2>
        {insights.length ? (
          <ol className="m-0 grid list-none gap-3 p-0">
            {insights.map((insight) => (
              <li key={insight.id}>
                <Link
                  className="insight-list-item"
                  href={`/insights/${insight.id}`}
                >
                  <span>
                    <strong>{insight.title}</strong>
                    <small>
                      {insight.range_start} to {insight.range_end} ·{" "}
                      {insight.status === "stale"
                        ? "Sources changed"
                        : "Current snapshot"}
                    </small>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[var(--muted)]">
            No insights yet. Odiina will not generate one automatically.
          </p>
        )}
      </section>
    </div>
  );
}
