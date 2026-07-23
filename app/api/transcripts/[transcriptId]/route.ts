import { type NextRequest } from "next/server";

import { withAiMutation } from "@/lib/ai/route";
import { derivedDeletionSchema } from "@/lib/validation/ai";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ transcriptId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const [{ transcriptId }, input] = await Promise.all([
      params,
      request.json().then((value) => derivedDeletionSchema.parse(value)),
    ]);
    if (input.kind !== "transcript" || input.artifactId !== transcriptId) {
      throw new Error("odiina_ai_artifact_unavailable");
    }
    const { data, error } = await supabase
      .schema("app")
      .rpc("delete_ai_derived_data", {
        p_kind: "transcript",
        p_artifact_id: transcriptId,
      });
    if (error) throw error;
    return data;
  });
}
