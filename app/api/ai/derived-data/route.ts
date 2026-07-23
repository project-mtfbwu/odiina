import { type NextRequest } from "next/server";

import { withAiMutation } from "@/lib/ai/route";
import { derivedDeletionSchema } from "@/lib/validation/ai";

export async function DELETE(request: NextRequest) {
  return withAiMutation(request, async (supabase) => {
    const input = derivedDeletionSchema.parse(await request.json());
    const { data, error } = await supabase
      .schema("app")
      .rpc("delete_ai_derived_data", {
        p_kind: input.kind,
        p_artifact_id: input.artifactId,
      });
    if (error) throw error;
    return data;
  });
}
