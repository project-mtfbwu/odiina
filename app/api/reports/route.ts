import type { NextRequest } from "next/server";

import { withReportMutation } from "@/lib/reports/route";
import { reportCreateSchema } from "@/lib/validation/report";

export async function POST(request: NextRequest) {
  return withReportMutation(request, async (supabase) => {
    const input = reportCreateSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("create_factual_report", {
        p_type: input.reportType,
        p_start: input.start,
        p_end: input.end,
        p_title: input.title,
        p_entry_ids: input.entryIds,
        p_include_places: input.includePlaces,
        p_client_request_id: input.clientRequestId,
      });
    if (error) throw error;
    return (data as { report_id: string }[] | null)?.[0];
  });
}
