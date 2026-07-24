import type { NextRequest } from "next/server";

import { withReportMutation } from "@/lib/reports/route";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  return withReportMutation(request, async (supabase) => {
    const { shareId } = await params;
    const { error } = await supabase.schema("app").rpc("revoke_report_share", {
      p_share_id: shareId,
    });
    if (error) throw error;
    return { shareId };
  });
}
