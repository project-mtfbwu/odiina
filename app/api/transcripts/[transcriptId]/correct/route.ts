import { type NextRequest } from "next/server";

import { withAiMutation } from "@/lib/ai/route";
import { transcriptCorrectionSchema } from "@/lib/validation/ai";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ transcriptId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const [{ transcriptId }, input] = await Promise.all([
      params,
      request.json().then((value) => transcriptCorrectionSchema.parse(value)),
    ]);
    const { data, error } = await supabase
      .schema("app")
      .rpc("correct_transcript_segment", {
        p_transcript_id: transcriptId,
        p_segment_id: input.segmentId,
        p_corrected_text: input.correctedText,
      });
    if (error) throw error;
    return { correctionId: data };
  });
}
