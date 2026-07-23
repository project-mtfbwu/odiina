"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { AiSettings } from "@/lib/ai/types";

type Preview = {
  entry_count: number;
  input_characters: number;
  transcript_count: number;
};

function civilDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export function InsightGenerator({
  settings,
  providerAvailable,
  csrfToken,
}: {
  settings: AiSettings;
  providerAvailable: boolean;
  csrfToken: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(civilDate(-6));
  const [to, setTo] = useState(civilDate());
  const [includeText, setIncludeText] = useState(true);
  const [includeTranscripts, setIncludeTranscripts] = useState(true);
  const [includePlaces, setIncludePlaces] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const allowed =
    settings.master_enabled && settings.insights_enabled && providerAvailable;
  const scope = useMemo(
    () => ({
      scope: "range",
      entryId: null,
      from,
      to,
      tags: [],
      media: [],
      includeAuthoredText: includeText,
      includeTranscripts,
      includePlaceLabels: includePlaces,
    }),
    [from, to, includeText, includeTranscripts, includePlaces],
  );

  async function call(path: string, body: object) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify(body),
    });
    const value = (await response.json()) as {
      result?: unknown;
      message?: string;
    };
    if (!response.ok)
      throw new Error(value.message ?? "The private AI request failed.");
    return value.result;
  }

  async function previewScope() {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      const value = (await call("/api/insights/preview", scope)) as Preview;
      setPreview(value);
      setMessage("Scope preview ready. Nothing has been sent to a provider.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not preview this scope.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = (await call("/api/insights/generate", {
        ...scope,
        clientRequestId: crypto.randomUUID(),
      })) as { job_id: string };
      setMessage(
        "Insight queued. Evidence is frozen to the current accepted revisions.",
      );
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(`/api/ai/jobs/${value.job_id}`, {
          cache: "no-store",
        });
        const status = (await response.json()) as {
          job?: { status: string; safe_error_code?: string };
        };
        if (status.job?.status === "ready") {
          router.refresh();
          return;
        }
        if (
          ["failed", "canceled", "dead_letter"].includes(
            status.job?.status ?? "",
          )
        )
          throw new Error(
            "Insight generation stopped safely. You can retry the job.",
          );
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      setMessage("Insight is still processing. Refresh this page shortly.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not generate this insight.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      {!allowed ? (
        <div className="form-error" role="status">
          Insights are unavailable. Enable them in{" "}
          <a className="font-bold underline" href="/settings/ai">
            private AI settings
          </a>
          ; a provider must also be approved.
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">From</span>
          <input
            className="input"
            type="date"
            value={from}
            max={to}
            onChange={(event) => {
              setFrom(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">To</span>
          <input
            className="input"
            type="date"
            value={to}
            min={from}
            onChange={(event) => {
              setTo(event.target.value);
              setPreview(null);
            }}
          />
        </label>
      </div>
      <fieldset className="grid gap-3">
        <legend className="field-label">Evidence included</legend>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={includeText}
            onChange={(event) => {
              setIncludeText(event.target.checked);
              setPreview(null);
            }}
          />
          <span>
            <strong>Authored Entry text</strong>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={includeTranscripts}
            onChange={(event) => {
              setIncludeTranscripts(event.target.checked);
              setPreview(null);
            }}
          />
          <span>
            <strong>Available transcript text</strong>
          </span>
        </label>
        <label className="ai-choice">
          <input
            type="checkbox"
            checked={includePlaces}
            onChange={(event) => {
              setIncludePlaces(event.target.checked);
              setPreview(null);
            }}
          />
          <span>
            <strong>Private place labels</strong>
            <small>
              Off by default because places can be particularly sensitive.
            </small>
          </span>
        </label>
      </fieldset>
      {preview ? (
        <div className="rounded-xl bg-[var(--accent-soft)] p-4" role="status">
          <strong>{preview.entry_count} Entries</strong> ·{" "}
          {preview.transcript_count} transcripts ·{" "}
          {preview.input_characters.toLocaleString()} input characters.
          Generation is approximate and can be incomplete.
        </div>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="m-0 text-sm text-[var(--muted)]" aria-live="polite">
        {message}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => void previewScope()}
        >
          Preview private scope
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !allowed || !preview}
          onClick={() => void generate()}
        >
          {busy ? "Working…" : "Generate from this snapshot"}
        </button>
      </div>
    </div>
  );
}
