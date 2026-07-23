import { type NextRequest } from "next/server";

import { getAiRuntimeStatus } from "@/lib/ai/config";
import { withAiMutation } from "@/lib/ai/route";
import { transcriptionRequestSchema } from "@/lib/validation/ai";

export async function POST(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    if (!getAiRuntimeStatus().providerAvailable) {
      throw new Error("odiina_ai_provider_unavailable");
    }
    const input = transcriptionRequestSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("request_transcription", {
        p_entry_id: input.entryId,
        p_revision_id: input.revisionId,
        p_attachment_id: input.attachmentId,
        p_client_request_id: input.clientRequestId,
        p_language_hint: input.languageHint,
      });
    if (error) throw error;
    return data?.[0] ?? null;
  });
}
