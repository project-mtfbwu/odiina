import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { getReportDetail } from "@/lib/database/queries";
import { reportMarkdown } from "@/lib/reports/public";
import { assertCsrf } from "@/lib/security/csrf";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const auth = await verifiedRequestClient(request);
  if (!auth.userId)
    return auth.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  try {
    assertCsrf(request, request.headers.get("x-odiina-csrf") ?? "");
    const { reportId } = await params;
    const { error } = await auth.supabase
      .schema("app")
      .rpc("record_report_export", {
        p_report_id: reportId,
        p_kind: "markdown",
      });
    if (error) throw error;
    const report = await getReportDetail(reportId);
    return auth.applyAuthState(
      new NextResponse(reportMarkdown(report), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="odiina-${report.report_type}-${report.period_start}.md"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      }),
    );
  } catch {
    return auth.applyAuthState(
      NextResponse.json({ error: "report_export_failed" }, { status: 400 }),
    );
  }
}
