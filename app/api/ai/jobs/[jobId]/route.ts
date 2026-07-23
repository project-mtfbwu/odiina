import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { withAiMutation } from "@/lib/ai/route";
import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

const actionSchema = z.object({ action: z.enum(["cancel", "retry"]) });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const auth = await verifiedRequestClient(request);
  if (!auth.userId) {
    return auth.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const { jobId } = await params;
  const { data, error } = await auth.supabase
    .schema("app")
    .from("ai_jobs")
    .select(
      "id,job_kind,status,safe_error_code,cancel_requested,attempts,updated_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  return auth.applyAuthState(
    error || !data
      ? NextResponse.json({ error: "ai_job_unavailable" }, { status: 404 })
      : NextResponse.json({ job: data }),
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const [{ jobId }, input] = await Promise.all([
      params,
      request.json().then((value) => actionSchema.parse(value)),
    ]);
    const functionName =
      input.action === "cancel" ? "cancel_ai_job" : "retry_ai_job";
    const { data, error } = await supabase
      .schema("app")
      .rpc(functionName, { p_job_id: jobId });
    if (error) throw error;
    return data;
  });
}
