import type { Metadata } from "next";
import { cookies } from "next/headers";

import { ChatWorkspace } from "@/components/chat-workspace";
import { getAiRuntimeStatus } from "@/lib/ai/config";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import {
  getAiSettings,
  getAiUsage,
  getChatConversations,
} from "@/lib/database/queries";

export const metadata: Metadata = {
  title: "Odiina Chat",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const [conversations, settings, usage, cookieStore] = await Promise.all([
    getChatConversations(),
    getAiSettings(),
    getAiUsage(),
    cookies(),
  ]);
  const runtime = getAiRuntimeStatus();
  return (
    <ChatWorkspace
      conversations={conversations}
      chatEnabled={
        settings.master_enabled &&
        settings.insights_enabled &&
        settings.chat_enabled
      }
      providerAvailable={runtime.providerAvailable}
      runtimeDisclosure={runtime.disclosure}
      usage={{
        questions_today: usage.chat_questions_today,
        questions_month: usage.chat_questions_month,
        active_chat_jobs: usage.active_jobs,
      }}
      csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
    />
  );
}
