import { type NextRequest } from "next/server";

import { getAiRuntimeStatus } from "@/lib/ai/config";
import { withAiMutation } from "@/lib/ai/route";
import { aiSettingsInputSchema } from "@/lib/validation/ai";

export async function PUT(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    const input = aiSettingsInputSchema.parse(await request.json());
    const runtime = getAiRuntimeStatus();
    if (input.masterEnabled && !runtime.providerAvailable) {
      throw new Error("odiina_ai_provider_unavailable");
    }
    const { data, error } = await supabase
      .schema("app")
      .rpc("update_ai_settings", {
        p_master_enabled: input.masterEnabled,
        p_transcription_enabled: input.transcriptionEnabled,
        p_insights_enabled: input.insightsEnabled,
        p_chat_enabled: input.chatEnabled,
        p_semantic_memory_enabled: false,
        p_transcript_search_enabled: input.transcriptSearchEnabled,
        p_auto_transcribe_enabled: false,
        p_consent_policy_version: "odiina-ai-consent-v1",
        p_provider_policy_version: runtime.providerAvailable
          ? "fake-local-v1"
          : null,
        p_source_surface: "settings_ai",
      });
    if (error) throw error;
    if (input.deleteDerivedData) {
      const deletion = await supabase
        .schema("app")
        .rpc("delete_ai_derived_data", {
          p_kind: "all",
          p_artifact_id: null,
        });
      if (deletion.error) throw deletion.error;
      const chatDeletion = await supabase
        .schema("app")
        .rpc("delete_all_chat_history", { p_include_temporary: true });
      if (chatDeletion.error) throw chatDeletion.error;
    }
    return data?.[0] ?? null;
  });
}
