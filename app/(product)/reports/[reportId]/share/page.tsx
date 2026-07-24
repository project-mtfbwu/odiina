import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { ReportActions } from "@/components/report-actions";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getReportDetail } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Export or share report" };
export const dynamic = "force-dynamic";

export default async function ShareReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const [report, cookieStore] = await Promise.all([
    getReportDetail(reportId),
    cookies(),
  ]);
  const visibleSections = new Set(
    report.sections
      .filter((section) => section.visible)
      .map((section) => section.section_kind),
  );
  const aiSection = report.sections.find(
    (section) => section.section_kind === "key_moments" && section.visible,
  );
  const evidenceReferences = report.citations
    .map((citation) =>
      report.sources.findIndex(
        (source) =>
          source.entry_id === citation.entry_id &&
          source.revision_id === citation.revision_id,
      ),
    )
    .filter((position) => position >= 0)
    .map((position) => `Moment ${position + 1}`);
  return (
    <div className="content-narrow">
      <header className="page-header">
        <div>
          <Link href={`/reports/${report.id}`}>← Back to private story</Link>
          <p className="eyebrow mt-4">Separate authorization boundary</p>
          <h1 className="page-title">Export or share</h1>
          <p className="page-description">
            The report stays private until you create a reviewed, expiring
            snapshot. Revocation cannot prevent screenshots or recall downloaded
            files.
          </p>
        </div>
      </header>
      {report.status === "stale" ? (
        <div className="form-error" role="status">
          Sources changed after this report snapshot. Review every included
          excerpt before creating a new share.
        </div>
      ) : null}
      <ReportActions
        reportId={report.id}
        csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
        shares={report.shares}
        review={{
          title: report.title,
          period: `${report.period_start} to ${report.period_end}`,
          introduction: visibleSections.has("cover") ? report.introduction : "",
          reflection: visibleSections.has("reflection")
            ? report.closing_reflection
            : "",
          aiNarrative: aiSection?.generated_text
            ? `${aiSection.generated_text}${
                evidenceReferences.length
                  ? `\n\nEvidence: ${evidenceReferences.join(", ")}`
                  : ""
              }`
            : "",
          metrics: visibleSections.has("at_a_glance")
            ? report.metrics.map(
                (metric) =>
                  `${metric.metric_key.replaceAll("_", " ")}: ${metric.metric_value}`,
              )
            : [],
          moments: visibleSections.has("timeline")
            ? report.sources
                .filter(
                  (source) => source.selected && !source.source_unavailable,
                )
                .map(
                  (source) =>
                    `${source.occurred_local_date} — ${source.body_excerpt || "Media moment"}`,
                )
            : [],
          places: visibleSections.has("places")
            ? [
                ...new Set(
                  report.sources
                    .filter((source) => source.selected && source.place_label)
                    .map((source) => source.place_label!),
                ),
              ]
            : [],
        }}
      />
    </div>
  );
}
