import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { DeleteAiArtifactButton } from "@/components/delete-ai-artifact-button";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getInsightDetail } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Private insight" };
export const dynamic = "force-dynamic";

export default async function InsightPage({
  params,
}: {
  params: Promise<{ insightId: string }>;
}) {
  const [{ insightId }, cookieStore] = await Promise.all([params, cookies()]);
  const insight = await getInsightDetail(insightId);
  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <Link className="back-link" href="/insights">
            ← Back to Insights
          </Link>
          <p className="eyebrow mt-5">
            {insight.status === "stale"
              ? "Source revisions changed"
              : "Evidence-linked snapshot"}
          </p>
          <h1 className="page-title">{insight.title}</h1>
          <p className="page-description">
            {insight.range_start} to {insight.range_end} · generated with{" "}
            {insight.provider_id}/{insight.model_id}
          </p>
        </div>
      </header>
      <article className="panel p-5 sm:p-7">
        <h2 className="mt-0 text-xl font-bold">Summary</h2>
        <p className="leading-7">{insight.summary}</p>
        {[
          ["Key moments", insight.key_moments],
          ["Topics", insight.topics],
          ["Open loops", insight.open_loops],
        ].map(([label, values]) => (
          <section key={label as string} className="mt-6">
            <h2 className="text-lg font-bold">{label as string}</h2>
            <ul>
              {(values as string[]).map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="mt-6" aria-labelledby="limitations-heading">
          <h2 id="limitations-heading" className="text-lg font-bold">
            Limitations
          </h2>
          <p>{insight.limitations}</p>
        </section>
        <section className="mt-6" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" className="text-lg font-bold">
            Evidence citations
          </h2>
          <ol className="grid gap-3">
            {insight.sources.map((source) => (
              <li
                key={source.id}
                className="rounded-xl border border-[var(--border)] p-4"
              >
                <Link href={`/entries/${source.entry_id}`}>
                  {source.occurred_local_date} · Open accepted Entry revision
                </Link>
                <p className="mb-0 text-sm text-[var(--muted)]">
                  {source.source_unavailable
                    ? "Source is no longer available."
                    : source.evidence_excerpt}
                  {source.start_ms !== null
                    ? ` · ${(source.start_ms / 1000).toFixed(1)}–${((source.end_ms ?? source.start_ms) / 1000).toFixed(1)} seconds`
                    : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
        <div className="mt-7 border-t border-[var(--border)] pt-5">
          <DeleteAiArtifactButton
            kind="insight"
            artifactId={insight.id}
            csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
          />
        </div>
      </article>
    </div>
  );
}
