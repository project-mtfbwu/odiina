import type { Metadata } from "next";

import { ReportStory } from "@/components/report-story";
import { getReportDetail } from "@/lib/database/queries";

export const metadata: Metadata = {
  title: "Print private report",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function PrintReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const report = await getReportDetail(reportId);
  return (
    <div className="print-shell">
      <p className="print-guidance">
        Use your browser’s Print command. Choose “Save as PDF” only if its
        output meets your needs; Odiina does not claim tagged-PDF conformance.
      </p>
      <ReportStory report={report} print />
    </div>
  );
}
