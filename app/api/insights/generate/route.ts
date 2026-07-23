import { type NextRequest } from "next/server";

import { getAiRuntimeStatus } from "@/lib/ai/config";
import { withAiMutation } from "@/lib/ai/route";
import { insightRequestSchema } from "@/lib/validation/ai";

export async function POST(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    if (!getAiRuntimeStatus().providerAvailable) {
      throw new Error("odiina_ai_provider_unavailable");
    }
    const input = insightRequestSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("request_insight", {
        p_scope: input.scope,
        p_entry_id: input.entryId,
        p_from: input.from,
        p_to: input.to,
        p_tag_names: input.tags,
        p_media: input.media,
        p_include_authored_text: input.includeAuthoredText,
        p_include_transcripts: input.includeTranscripts,
        p_include_place_labels: input.includePlaceLabels,
        p_client_request_id: input.clientRequestId,
      });
    if (error) throw error;
    return data?.[0] ?? null;
  });
}
