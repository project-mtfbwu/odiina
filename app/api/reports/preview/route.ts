import type { NextRequest } from "next/server";

import { withReportMutation } from "@/lib/reports/route";
import { reportPreviewSchema } from "@/lib/validation/report";

export async function POST(request: NextRequest) {
  return withReportMutation(request, async (supabase) => {
    const input = reportPreviewSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("preview_factual_report", {
        p_type: input.reportType,
        p_start: input.start,
        p_end: input.end,
        p_entry_ids: input.entryIds,
      });
    if (error) throw error;
    const sourceResult = await supabase
      .schema("app")
      .from("entry_search_documents")
      .select(
        "entry_id,occurred_local_date,body_text,has_image,has_audio,has_video,has_place,tag_normalized_names",
      )
      .eq("lifecycle_state", "active")
      .gte("occurred_local_date", input.start)
      .lte("occurred_local_date", input.end)
      .order("occurred_at", { ascending: true })
      .order("entry_id", { ascending: true })
      .limit(200);
    if (sourceResult.error) throw sourceResult.error;
    return {
      ...((data as Record<string, number>[] | null)?.[0] ?? {}),
      sources: (sourceResult.data ?? []).map((source) => ({
        ...source,
        body_text: source.body_text.slice(0, 240),
      })),
    };
  });
}
