import type { Metadata } from "next";
import Link from "next/link";

import { ReportStory } from "@/components/report-story";
import { getReportDetail } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Private recap" };
export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const report = await getReportDetail(reportId);
  return (
    <div className="report-page">
      <div className="report-toolbar">
        <Link href="/reports">← Reports</Link>
        <div>
          <Link
            className="button button-secondary"
            href={`/reports/${report.id}/edit`}
          >
            Edit and curate
          </Link>
          <Link
            className="button button-primary"
            href={`/reports/${report.id}/share`}
          >
            Export or share
          </Link>
        </div>
      </div>
      <ReportStory report={report} />
    </div>
  );
}
