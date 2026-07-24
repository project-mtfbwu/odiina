import type { NextRequest } from "next/server";

import { withReportMutation } from "@/lib/reports/route";
import { reportUpdateSchema } from "@/lib/validation/report";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return withReportMutation(request, async (supabase) => {
    const { reportId } = await params;
    const input = reportUpdateSchema.parse(await request.json());
    const { error } = await supabase.schema("app").rpc("update_report", {
      p_report_id: reportId,
      p_title: input.title,
      p_introduction: input.introduction,
      p_reflection: input.reflection,
      p_hidden_sections: input.hiddenSections,
      p_section_order: input.sectionOrder,
      p_selected_entries: input.selectedEntryIds,
      p_selected_attachments: input.selectedAttachmentIds,
      p_cover_attachment_id: input.coverAttachmentId,
      p_insight_id: input.insightId ?? null,
    });
    if (error) throw error;
    return { reportId };
  });
}
