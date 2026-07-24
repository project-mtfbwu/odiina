import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { ReportEditor } from "@/components/report-editor";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import {
  getAiSettings,
  getInsights,
  getReportDetail,
} from "@/lib/database/queries";

export const metadata: Metadata = { title: "Edit private report" };
export const dynamic = "force-dynamic";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const [report, insights, settings, cookieStore] = await Promise.all([
    getReportDetail(reportId),
    getInsights(),
    getAiSettings(),
    cookies(),
  ]);
  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <Link href={`/reports/${report.id}`}>← Back to story</Link>
          <p className="eyebrow mt-4">Curated derived artifact</p>
          <h1 className="page-title">Edit report</h1>
          <p className="page-description">
            Edits here never change Entries, transcripts, media, places or
            already published snapshots.
          </p>
        </div>
      </header>
      <section className="panel p-5 sm:p-7">
        <ReportEditor
          report={report}
          insights={insights}
          aiEnabled={settings.master_enabled && settings.insights_enabled}
          csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
        />
      </section>
    </div>
  );
}
