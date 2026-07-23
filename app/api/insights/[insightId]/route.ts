import { type NextRequest } from "next/server";

import { withAiMutation } from "@/lib/ai/route";
import { derivedDeletionSchema } from "@/lib/validation/ai";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ insightId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const [{ insightId }, input] = await Promise.all([
      params,
      request.json().then((value) => derivedDeletionSchema.parse(value)),
    ]);
    if (input.kind !== "insight" || input.artifactId !== insightId) {
      throw new Error("odiina_ai_artifact_unavailable");
    }
    const { data, error } = await supabase
      .schema("app")
      .rpc("delete_ai_derived_data", {
        p_kind: "insight",
        p_artifact_id: insightId,
      });
    if (error) throw error;
    return data;
  });
}
