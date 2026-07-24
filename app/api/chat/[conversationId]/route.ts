import { type NextRequest } from "next/server";
import { z } from "zod";

import { withAiMutation } from "@/lib/ai/route";
import { chatUpdateSchema } from "@/lib/validation/chat";

const idSchema = z.uuid();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const [{ conversationId }, input] = await Promise.all([
      params,
      request.json().then((value) => chatUpdateSchema.parse(value)),
    ]);
    const id = idSchema.parse(conversationId);
    const rpc =
      input.action === "rename"
        ? ["rename_chat", { p_conversation_id: id, p_title: input.title }]
        : input.action === "convert"
          ? [
              "convert_temporary_chat",
              { p_conversation_id: id, p_title: input.title },
            ]
          : ["clear_chat_context", { p_conversation_id: id }];
    const { data, error } = await supabase
      .schema("app")
      .rpc(rpc[0] as string, rpc[1] as Record<string, unknown>);
    if (error) throw error;
    return data;
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  return withAiMutation(request, async (supabase) => {
    const { conversationId } = await params;
    const { data, error } = await supabase.schema("app").rpc("delete_chat", {
      p_conversation_id: idSchema.parse(conversationId),
    });
    if (error) throw error;
    return data;
  });
}
