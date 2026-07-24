import { type NextRequest } from "next/server";

import { getAiRuntimeStatus } from "@/lib/ai/config";
import { withAiMutation } from "@/lib/ai/route";
import { planChatQuestion } from "@/lib/chat/planner";
import type { ChatRetrievalPlan } from "@/lib/chat/types";
import {
  localRateLimiter,
  privacySafeRateLimitKey,
} from "@/lib/security/rate-limit";
import { chatRequestSchema, deleteAllChatSchema } from "@/lib/validation/chat";

function todayInTimezone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function POST(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    if (!getAiRuntimeStatus().providerAvailable) {
      throw new Error("odiina_ai_provider_unavailable");
    }
    const input = chatRequestSchema.parse(await request.json());
    const claims = await supabase.auth.getClaims();
    const userId = String(claims.data?.claims.sub ?? "");
    const rate = localRateLimiter.take(
      privacySafeRateLimitKey(`chat:${userId}`),
      12,
      60,
    );
    if (!rate.allowed) throw new Error("odiina_chat_rate_limited");

    const [settingsResult, preferencesResult, conversationResult] =
      await Promise.all([
        supabase
          .schema("app")
          .from("ai_settings")
          .select(
            "master_enabled,insights_enabled,chat_enabled,transcript_search_enabled",
          )
          .single(),
        supabase
          .schema("app")
          .from("user_preferences")
          .select("iana_timezone,week_starts_on")
          .single(),
        input.conversationId
          ? supabase
              .schema("app")
              .from("chat_conversations")
              .select("context_state")
              .eq("id", input.conversationId)
              .eq("status", "active")
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
    const firstError =
      settingsResult.error ??
      preferencesResult.error ??
      conversationResult.error;
    if (firstError) throw firstError;
    const settings = settingsResult.data;
    const preferences = preferencesResult.data;
    if (
      !settings?.master_enabled ||
      !settings.insights_enabled ||
      !settings.chat_enabled
    ) {
      throw new Error("odiina_chat_consent_required");
    }
    const timezone = preferences?.iana_timezone ?? "UTC";
    const previous = conversationResult.data?.context_state as
      ChatRetrievalPlan | undefined;
    const plan = planChatQuestion(input.question, {
      today: todayInTimezone(timezone),
      weekStartsOn: Number(preferences?.week_starts_on ?? 1),
      transcriptSearchEnabled: Boolean(settings.transcript_search_enabled),
      previous,
    });
    const { data, error } = await supabase.schema("app").rpc("request_chat", {
      p_conversation_id: input.conversationId,
      p_mode: input.mode,
      p_question: input.question,
      p_plan: plan,
      p_client_request_id: input.clientRequestId,
    });
    if (error) throw error;
    return { ...(data?.[0] ?? null), plan };
  });
}

export async function DELETE(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    const input = deleteAllChatSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("delete_all_chat_history", {
        p_include_temporary: input.includeTemporary,
      });
    if (error) throw error;
    return { deleted: data };
  });
}
