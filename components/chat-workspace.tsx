"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SendIcon } from "@/components/icons";
import type {
  ChatCitation,
  ChatConversationDetail,
  ChatConversationListItem,
  ChatMode,
  ChatUsage,
} from "@/lib/chat/types";

function citationHref(citation: ChatCitation): string | null {
  if (citation.source_unavailable) return null;
  if (citation.source_kind === "report" && citation.report_id)
    return `/reports/${citation.report_id}`;
  if (citation.source_kind === "insight" && citation.insight_id)
    return `/insights/${citation.insight_id}`;
  if (citation.entry_id) {
    const query =
      citation.start_ms === null ? "" : `?seekMs=${citation.start_ms}`;
    const fragment = citation.transcript_segment_id
      ? `#transcript-${citation.transcript_segment_id}`
      : "";
    return `/entries/${citation.entry_id}${query}${fragment}`;
  }
  return null;
}

function ConversationHistory({
  conversations,
  currentId,
  onDeleteAll,
}: {
  conversations: ChatConversationListItem[];
  currentId?: string;
  onDeleteAll: () => void;
}) {
  return (
    <nav aria-label="Saved Odiina Chat conversations">
      <Link className="button button-primary chat-new-button" href="/chat">
        New Chat
      </Link>
      {conversations.length ? (
        <ol className="chat-conversation-list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/chat/${conversation.id}`}
                aria-current={
                  conversation.id === currentId ? "page" : undefined
                }
              >
                <strong>{conversation.title}</strong>
                <small>
                  Saved ·{" "}
                  {new Date(conversation.last_activity_at).toLocaleString()}
                </small>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="chat-history-empty">No saved conversations yet.</p>
      )}
      {conversations.length ? (
        <button
          className="text-button danger-link"
          type="button"
          onClick={onDeleteAll}
        >
          Delete all Chat history
        </button>
      ) : null}
    </nav>
  );
}

export function ChatWorkspace({
  conversations,
  conversation,
  chatEnabled,
  providerAvailable,
  runtimeDisclosure,
  usage,
  csrfToken,
}: {
  conversations: ChatConversationListItem[];
  conversation?: ChatConversationDetail;
  chatEnabled: boolean;
  providerAvailable: boolean;
  runtimeDisclosure: string;
  usage: ChatUsage;
  csrfToken: string;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<ChatMode>(conversation?.mode ?? "saved");
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation?.title ?? "");
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const answerHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (conversation?.messages.at(-1)?.role === "assistant") {
      answerHeadingRef.current?.focus();
    }
  }, [conversation?.messages]);

  async function pollJob(id: string, conversationId: string) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/ai/jobs/${id}`, { cache: "no-store" });
      const payload = (await response.json()) as {
        job?: { status: string; safe_error_code: string | null };
      };
      if (!response.ok || !payload.job)
        throw new Error("Chat job unavailable.");
      if (payload.job.status === "ready") {
        setPhase("Answer ready.");
        if (conversation?.id === conversationId) {
          window.location.reload();
        } else {
          router.push(`/chat/${conversationId}`);
        }
        return;
      }
      if (["failed", "canceled", "dead_letter"].includes(payload.job.status)) {
        throw new Error(
          payload.job.safe_error_code === "consent_revoked"
            ? "Chat stopped because consent changed."
            : "Odiina Chat could not complete this answer.",
        );
      }
      setPhase(
        payload.job.status === "processing_response"
          ? "Validating citations…"
          : payload.job.status === "generating"
            ? "Generating a bounded answer…"
            : "Retrieving authorized evidence…",
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error("Odiina Chat timed out. You can safely try again.");
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setPhase("Resolving dates and private Search filters…");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          conversationId: conversation?.id ?? null,
          mode: conversation?.mode ?? mode,
          question,
          clientRequestId: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        result?: { conversation_id: string; job_id: string };
      };
      if (!response.ok || !payload.result)
        throw new Error(payload.message ?? "Could not ask Odiina.");
      setJobId(payload.result.job_id);
      setQuestion("");
      await pollJob(payload.result.job_id, payload.result.conversation_id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not ask Odiina.",
      );
      setPhase("");
    } finally {
      setBusy(false);
      setJobId(null);
    }
  }

  async function cancel() {
    if (!jobId) return;
    await fetch(`/api/ai/jobs/${jobId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify({ action: "cancel" }),
    });
    setPhase("Canceled.");
  }

  async function updateConversation(
    body: Record<string, string>,
    successPath?: string,
  ) {
    if (!conversation) return;
    setError("");
    const response = await fetch(`/api/chat/${conversation.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setError(payload.message ?? "Could not update this Chat.");
      return;
    }
    setRenaming(false);
    if (successPath) {
      window.location.assign(successPath);
    } else {
      window.location.reload();
    }
  }

  async function deleteConversation() {
    if (!conversation || !window.confirm("Delete this Chat and its citations?"))
      return;
    const response = await fetch(`/api/chat/${conversation.id}`, {
      method: "DELETE",
      headers: { "x-odiina-csrf": csrfToken },
    });
    if (!response.ok) {
      setError("Could not delete this Chat.");
      return;
    }
    router.push("/chat");
    router.refresh();
  }

  async function deleteAll() {
    if (
      !window.confirm(
        "Delete every saved and temporary Chat? Original Entries remain.",
      )
    )
      return;
    const response = await fetch("/api/chat", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify({
        confirmation: "DELETE CHAT HISTORY",
        includeTemporary: true,
      }),
    });
    if (!response.ok) {
      setError("Could not delete Chat history.");
      return;
    }
    router.push("/chat");
    router.refresh();
  }

  const enabled = chatEnabled && providerAvailable;
  const latestAssistant = [...(conversation?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");

  return (
    <div className="chat-shell">
      <aside className="chat-history-desktop">
        <div className="chat-brand" aria-label="OC, Odiina Chat">
          <span aria-hidden="true">OC</span>
          <div>
            <strong>Odiina Chat</strong>
            <small>Private memory conversations</small>
          </div>
        </div>
        <ConversationHistory
          conversations={conversations}
          currentId={conversation?.id}
          onDeleteAll={() => void deleteAll()}
        />
      </aside>

      <section className="chat-main" aria-labelledby="chat-heading">
        <header className="chat-header">
          <div>
            <p className="eyebrow">OC · private and read-only</p>
            <h1 id="chat-heading">Odiina Chat</h1>
            <p>Ask your Odiina memory</p>
          </div>
          <details className="chat-history-mobile">
            <summary>Conversations</summary>
            <ConversationHistory
              conversations={conversations}
              currentId={conversation?.id}
              onDeleteAll={() => void deleteAll()}
            />
          </details>
        </header>

        {!enabled ? (
          <section
            className="chat-state-card"
            aria-labelledby="chat-disabled-heading"
          >
            <span className="chat-oc-mark" aria-hidden="true">
              OC
            </span>
            <h2 id="chat-disabled-heading">
              {providerAvailable
                ? "Chat consent required"
                : "Provider not configured"}
            </h2>
            <p>
              {providerAvailable
                ? "Enable Master AI, private Insights and Odiina Chat in AI settings. Chat is never enabled by transcription consent."
                : runtimeDisclosure}
            </p>
            <Link className="button button-primary" href="/settings/ai">
              Review AI settings
            </Link>
          </section>
        ) : conversation ? (
          <>
            <div className="chat-conversation-toolbar">
              <div>
                {renaming ? (
                  <label>
                    <span className="sr-only">Conversation title</span>
                    <input
                      className="input"
                      value={title}
                      maxLength={120}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                ) : (
                  <h2>{conversation.title}</h2>
                )}
                <p>
                  {conversation.mode === "temporary"
                    ? `Temporary Chat · expires ${new Date(conversation.expires_at!).toLocaleString()}`
                    : "Saved Chat"}
                </p>
              </div>
              <div className="chat-toolbar-actions">
                {renaming ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      void updateConversation({ action: "rename", title })
                    }
                  >
                    Save title
                  </button>
                ) : conversation.mode === "saved" ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setRenaming(true)}
                  >
                    Rename
                  </button>
                ) : (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      void updateConversation(
                        { action: "convert", title: conversation.title },
                        `/chat/${conversation.id}`,
                      )
                    }
                  >
                    Save this Chat
                  </button>
                )}
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void updateConversation({ action: "clear_context" })
                  }
                >
                  Reset context
                </button>
                <a
                  className="text-button"
                  href={`/api/chat/${conversation.id}/export`}
                >
                  Export text
                </a>
                <button
                  className="text-button danger-link"
                  type="button"
                  onClick={() => void deleteConversation()}
                >
                  Delete
                </button>
              </div>
            </div>
            <ol className="chat-messages" aria-label="Conversation messages">
              {conversation.messages.map((message) => (
                <li key={message.id}>
                  <article
                    className="chat-message"
                    data-role={message.role}
                    aria-label={message.role === "user" ? "You" : "Odiina Chat"}
                  >
                    <p className="chat-message-role">
                      {message.role === "user" ? "You" : "OC"}
                    </p>
                    <p>{message.content}</p>
                    {message.unsupported_claims_removed ? (
                      <p className="chat-answer-warning">
                        Unsupported content was removed during validation.
                      </p>
                    ) : null}
                    {message.citations.length ? (
                      <section
                        className="chat-citations"
                        aria-label="Evidence sources"
                      >
                        <h3>Sources</h3>
                        <ol>
                          {message.citations.map((citation) => {
                            const href = citationHref(citation);
                            const label = `${citation.citation_key} · ${citation.source_kind}${citation.occurred_local_date ? ` · ${citation.occurred_local_date}` : ""}`;
                            return (
                              <li key={citation.id}>
                                {href ? (
                                  <Link href={href}>{label}</Link>
                                ) : (
                                  <span>{label} · unavailable</span>
                                )}
                                <small>{citation.evidence_excerpt}</small>
                                {citation.source_stale ? (
                                  <em>Source changed</em>
                                ) : null}
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    ) : message.role === "assistant" ? (
                      <p className="chat-no-evidence">
                        No matching evidence was cited.
                      </p>
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
            {latestAssistant ? (
              <h2 ref={answerHeadingRef} tabIndex={-1} className="sr-only">
                Latest Odiina Chat answer ready
              </h2>
            ) : null}
          </>
        ) : (
          <section className="chat-empty-state">
            <span className="chat-oc-mark" aria-hidden="true">
              OC
            </span>
            <h2>Ask Odiina</h2>
            <p>
              Answers use current private Search evidence only. OC cannot browse
              the web, inspect visuals, interpret untranscribed audio or act on
              your data.
            </p>
            <div
              className="chat-mode-picker"
              role="group"
              aria-label="Chat retention"
            >
              <button
                type="button"
                data-active={mode === "saved" || undefined}
                onClick={() => setMode("saved")}
              >
                Saved Chat
              </button>
              <button
                type="button"
                data-active={mode === "temporary" || undefined}
                onClick={() => setMode("temporary")}
              >
                Temporary Chat
              </button>
            </div>
            {mode === "temporary" ? (
              <p className="chat-temporary-notice" role="status">
                Temporary content is excluded from history and deleted at logout
                or within one hour. Save it before expiry if you want to keep
                it.
              </p>
            ) : null}
          </section>
        )}

        {enabled ? (
          <div className="chat-composer-wrap">
            <form
              className="chat-composer"
              data-ready={hydrated}
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <label htmlFor="chat-question">Ask Odiina</label>
              <div>
                <textarea
                  id="chat-question"
                  value={question}
                  maxLength={2000}
                  rows={2}
                  placeholder="What did I practice on guitar last month?"
                  disabled={busy}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void ask();
                    }
                  }}
                />
                <button
                  className="chat-send-button"
                  type="submit"
                  disabled={busy || !question.trim()}
                  aria-label="Ask Odiina"
                >
                  <SendIcon className="size-5" />
                </button>
              </div>
              <small>
                {usage.questions_today}/30 questions today ·{" "}
                {usage.questions_month}/300 this month
              </small>
            </form>
            {busy && jobId ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void cancel()}
              >
                Stop response
              </button>
            ) : null}
            <p className="chat-status" aria-live="polite" role="status">
              {phase}
            </p>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
