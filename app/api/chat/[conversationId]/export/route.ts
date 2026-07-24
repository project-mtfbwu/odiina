import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const auth = await verifiedRequestClient(request);
  if (!auth.userId) {
    return auth.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const { conversationId } = await params;
  const id = z.uuid().parse(conversationId);
  const [conversation, messages] = await Promise.all([
    auth.supabase
      .schema("app")
      .from("chat_conversations")
      .select("title,mode,created_at")
      .eq("id", id)
      .eq("status", "active")
      .maybeSingle(),
    auth.supabase
      .schema("app")
      .from("chat_messages")
      .select("role,content,created_at")
      .eq("conversation_id", id)
      .order("created_at")
      .limit(100),
  ]);
  if (conversation.error || messages.error || !conversation.data) {
    return auth.applyAuthState(
      NextResponse.json({ error: "chat_unavailable" }, { status: 404 }),
    );
  }
  const body = [
    `# ${conversation.data.title}`,
    "",
    `Private Odiina Chat export · ${conversation.data.mode}`,
    "",
    ...(messages.data ?? []).flatMap((message) => [
      `## ${message.role === "user" ? "You" : "OC"}`,
      "",
      message.content.replace(/[<>]/gu, ""),
      "",
    ]),
  ].join("\n");
  return auth.applyAuthState(
    new NextResponse(body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="odiina-chat-${id.slice(0, 8)}.md"`,
        "content-type": "text/markdown; charset=utf-8",
      },
    }),
  );
}
