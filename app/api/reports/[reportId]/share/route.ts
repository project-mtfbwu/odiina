import type { NextRequest } from "next/server";

import { withReportMutation } from "@/lib/reports/route";
import { reportShareSchema } from "@/lib/validation/report";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return withReportMutation(request, async (supabase) => {
    const { reportId } = await params;
    const input = reportShareSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("publish_report_share", {
        p_report_id: reportId,
        p_expires_at: input.expiresAt,
        p_include_places: input.includePlaces,
        p_client_request_id: input.clientRequestId,
      });
    if (error) throw error;
    return (data as { share_id: string; share_token: string }[] | null)?.[0];
  });
}
