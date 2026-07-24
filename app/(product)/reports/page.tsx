import type { Metadata } from "next";
import Link from "next/link";

import { getReports } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Private reports" };
export const dynamic = "force-dynamic";

const reportTypes = ["daily", "weekly", "monthly", "yearly", "custom"] as const;
const reportStates = ["draft", "ready", "shared", "stale"] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; state?: string }>;
}) {
  const requested = await searchParams;
  const type = reportTypes.find((value) => value === requested.type);
  const state = reportStates.find((value) => value === requested.state);
  const reports = await getReports({ type, state });
  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <p className="eyebrow">Private by default</p>
          <h1 className="page-title">Reports</h1>
          <p className="page-description">
            Create factual recaps without AI, then curate, export or publish a
            separate expiring text snapshot.
          </p>
        </div>
        <Link className="button button-primary" href="/reports/new">
          New recap
        </Link>
      </header>
      <form className="report-library-filters" method="get">
        <label>
          <span>Report type</span>
          <select className="input" name="type" defaultValue={type ?? ""}>
            <option value="">All types</option>
            {reportTypes.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select className="input" name="state" defaultValue={state ?? ""}>
            <option value="">All states</option>
            {reportStates.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" type="submit">
          Apply filters
        </button>
        {type || state ? (
          <Link className="text-button" href="/reports">
            Clear
          </Link>
        ) : null}
      </form>
      {reports.length ? (
        <ol className="report-library">
          {reports.map((report) => (
            <li key={report.id}>
              <Link href={`/reports/${report.id}`}>
                <span className="report-type-label">{report.report_type}</span>
                <strong>{report.title}</strong>
                <small>
                  {report.period_start} to {report.period_end}
                </small>
                <time dateTime={report.generated_at}>
                  Generated {new Date(report.generated_at).toLocaleString()}
                </time>
                <span className="report-library-state">
                  {report.generation_mode === "ai_enhanced"
                    ? "AI-enhanced"
                    : "Factual"}{" "}
                  · {report.status} ·{" "}
                  {report.active_share_count ? "Shared" : "Private"}
                  {report.export_count
                    ? ` · ${report.export_count} export`
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <section className="panel empty-state">
          <h2>No reports yet</h2>
          <p>
            Your Entries remain useful without AI. Start with a factual daily,
            weekly, monthly or yearly recap.
          </p>
          <Link className="button button-primary" href="/reports/new">
            Create first recap
          </Link>
        </section>
      )}
    </div>
  );
}
