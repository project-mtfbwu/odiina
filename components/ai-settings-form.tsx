"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AiSettings, AiUsage } from "@/lib/ai/types";
import type { AiRuntimeStatus } from "@/lib/ai/config";

export function AiSettingsForm({
  initial,
  usage,
  runtime,
  csrfToken,
}: {
  initial: AiSettings;
  usage: AiUsage;
  runtime: AiRuntimeStatus;
  csrfToken: string;
}) {
  const router = useRouter();
  const [master, setMaster] = useState(initial.master_enabled);
  const [transcription, setTranscription] = useState(
    initial.transcription_enabled,
  );
  const [insights, setInsights] = useState(initial.insights_enabled);
  const [chat, setChat] = useState(initial.chat_enabled);
  const [search, setSearch] = useState(initial.transcript_search_enabled);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function changeMaster(enabled: boolean) {
    setMaster(enabled);
    if (!enabled) {
      setTranscription(false);
      setInsights(false);
      setSearch(false);
      setChat(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          masterEnabled: master,
          transcriptionEnabled: master && transcription,
          insightsEnabled: master && insights,
          chatEnabled: master && insights && chat,
          semanticMemoryEnabled: false,
          transcriptSearchEnabled: master && transcription && search,
          autoTranscribeEnabled: false,
          deleteDerivedData: !master && deleteData,
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? "Could not save AI settings.");
      setMessage("Private AI settings saved.");
      setDeleteData(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save AI settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <p className="m-0 font-bold">Provider status</p>
        <p className="mt-2 mb-0 text-sm leading-6 text-[var(--muted)]">
          {runtime.disclosure}
        </p>
      </div>
      {!runtime.providerAvailable ? (
        <div className="form-error" role="status">
          AI remains off. Enabling is blocked until an approved provider is
          configured.
        </div>
      ) : null}
      <fieldset className="grid gap-4" disabled={busy}>
        <legend className="sr-only">Private AI consent controls</legend>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={master}
            disabled={!runtime.providerAvailable && !master}
            onChange={(event) => changeMaster(event.target.checked)}
          />
          <span>
            <strong>Enable private AI processing</strong>
            <small>
              Master kill switch. Off by default and required for every AI
              request.
            </small>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={transcription}
            disabled={!master}
            onChange={(event) => {
              setTranscription(event.target.checked);
              if (!event.target.checked) setSearch(false);
            }}
          />
          <span>
            <strong>Allow requested transcription</strong>
            <small>
              Voice notes and video audio are sent only after you request a
              transcript. Automatic transcription stays unavailable.
            </small>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={search}
            disabled={!master || !transcription}
            onChange={(event) => setSearch(event.target.checked)}
          />
          <span>
            <strong>Include transcripts in private Search</strong>
            <small>
              Corrected text is preferred. Turning this off removes transcript
              text from the search projection.
            </small>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={insights}
            disabled={!master}
            onChange={(event) => {
              setInsights(event.target.checked);
              if (!event.target.checked) setChat(false);
            }}
          />
          <span>
            <strong>Allow requested private insights</strong>
            <small>
              You preview scope and evidence counts before each generated
              insight.
            </small>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={chat}
            disabled={!master || !insights}
            onChange={(event) => setChat(event.target.checked)}
          />
          <span>
            <strong>Allow Odiina Chat</strong>
            <small>
              Lets Ask Odiina send a bounded, reviewed evidence packet to the
              configured provider. Chat remains read-only and off by default.
            </small>
          </span>
        </label>
        <label className="ai-choice" aria-disabled="true">
          <input type="checkbox" checked={false} disabled readOnly />
          <span>
            <strong>Semantic Memory</strong>
            <small>
              Off and unavailable. No embedding provider or vector index is
              approved; Chat uses private lexical Search instead.
            </small>
          </span>
        </label>
        {!master && initial.master_enabled ? (
          <label className="ai-choice ai-choice-danger">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(event) => setDeleteData(event.target.checked)}
            />
            <span>
              <strong>Also delete all AI-derived data</strong>
              <small>
                Removes transcripts, corrections, insights, Chat history and
                searchable derivatives. Original Entries and media remain.
              </small>
            </span>
          </label>
        ) : null}
      </fieldset>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="button button-primary"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save AI choices"}
        </button>
        <span className="text-sm text-[var(--success)]" aria-live="polite">
          {message}
        </span>
      </div>
      <dl className="ai-usage" aria-label="Private AI usage limits">
        <div>
          <dt>Transcription this month</dt>
          <dd>{usage.transcription_minutes_month.toFixed(1)} / 1,200 min</dd>
        </div>
        <div>
          <dt>Insights today</dt>
          <dd>{usage.insight_requests_today} / 10</dd>
        </div>
        <div>
          <dt>Insights this month</dt>
          <dd>{usage.insight_requests_month} / 100</dd>
        </div>
        <div>
          <dt>Active jobs</dt>
          <dd>{usage.active_jobs} / 2</dd>
        </div>
        <div>
          <dt>Chat questions today</dt>
          <dd>{usage.chat_questions_today} / 30</dd>
        </div>
        <div>
          <dt>Chat questions this month</dt>
          <dd>{usage.chat_questions_month} / 300</dd>
        </div>
      </dl>
      <p className="text-xs leading-5 text-[var(--muted)]">
        Consent policy {initial.consent_policy_version}, version{" "}
        {initial.consent_version}. Disabling the master switch cancels queued
        jobs and asks active workers to stop. Provider retention and geographic
        processing require separate approval before live use.
      </p>
    </div>
  );
}
