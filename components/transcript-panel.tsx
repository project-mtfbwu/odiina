"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { DeleteAiArtifactButton } from "@/components/delete-ai-artifact-button";
import type { EntryTranscriptState } from "@/lib/ai/types";
import type { EntryMedia } from "@/lib/database/types";

const activeStatuses = new Set([
  "queued",
  "sending",
  "transcribing",
  "processing_response",
]);

export function TranscriptPanel({
  entryId,
  revisionId,
  media,
  state,
  enabled,
  providerAvailable,
  initialSeekMs,
  csrfToken,
}: {
  entryId: string;
  revisionId: string;
  media: EntryMedia[];
  state: EntryTranscriptState;
  enabled: boolean;
  providerAvailable: boolean;
  initialSeekMs?: number | null;
  csrfToken: string;
}) {
  const router = useRouter();
  const source = media.find(
    (item) =>
      item.media_kind === "audio" ||
      (item.media_kind === "video" && item.has_audio),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");

  useEffect(() => {
    if (initialSeekMs === null || initialSeekMs === undefined) return;
    window.dispatchEvent(
      new CustomEvent("odiina:media-seek", {
        detail: { milliseconds: initialSeekMs },
      }),
    );
  }, [initialSeekMs]);

  if (!source) return null;
  async function requestTranscript() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/transcripts/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          entryId,
          revisionId,
          attachmentId: source!.attachment_id,
          clientRequestId: crypto.randomUUID(),
          languageHint: null,
        }),
      });
      const result = (await response.json()) as {
        result?: { job_id: string };
        message?: string;
      };
      if (!response.ok || !result.result)
        throw new Error(result.message ?? "Could not request a transcript.");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const poll = await fetch(`/api/ai/jobs/${result.result.job_id}`, {
          cache: "no-store",
        });
        const value = (await poll.json()) as { job?: { status: string } };
        if (value.job?.status === "ready") {
          router.refresh();
          return;
        }
        if (
          ["failed", "canceled", "dead_letter"].includes(
            value.job?.status ?? "",
          )
        )
          throw new Error("Transcription stopped safely. Retry when ready.");
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not request a transcript.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveCorrection(segmentId: string) {
    if (!state.transcript) return;
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/transcripts/${state.transcript.id}/correct`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({ segmentId, correctedText: correction }),
      },
    );
    if (!response.ok) {
      const result = (await response.json()) as { message?: string };
      setError(result.message ?? "Could not save the correction.");
      setBusy(false);
      return;
    }
    setEditing(null);
    setCorrection("");
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="transcript-panel" aria-labelledby="transcript-heading">
      <div className="transcript-heading-row">
        <div>
          <p className="eyebrow">Optional AI derivative</p>
          <h2 id="transcript-heading">Transcript</h2>
        </div>
        {state.transcript ? (
          <span className="private-badge">
            {state.transcript.language ?? "Language unknown"}
          </span>
        ) : null}
      </div>
      {!state.transcript ? (
        <>
          <p className="text-sm leading-6 text-[var(--muted)]">
            Odiina does not transcribe automatically. A request uses only this
            accepted{" "}
            {source.media_kind === "video" ? "video audio track" : "voice note"}
            ; the original media is unchanged.
          </p>
          {state.job && activeStatuses.has(state.job.status) ? (
            <p role="status" className="ai-job-status">
              {state.job.status.replaceAll("_", " ")}…
            </p>
          ) : (
            <button
              className="button button-secondary"
              type="button"
              disabled={busy || !enabled || !providerAvailable}
              onClick={() => void requestTranscript()}
            >
              {busy ? "Transcribing…" : "Request transcript"}
            </button>
          )}
          {!enabled || !providerAvailable ? (
            <p className="text-sm text-[var(--muted)]">
              Enable transcription in private AI settings and configure an
              approved provider first.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <ol className="transcript-segments">
            {state.transcript.segments.map((segment) => (
              <li key={segment.id} id={`transcript-${segment.id}`}>
                <button
                  className="transcript-time"
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("odiina:media-seek", {
                        detail: {
                          attachmentId: source.attachment_id,
                          seconds: segment.start_ms / 1000,
                        },
                      }),
                    )
                  }
                  aria-label={`Play media at ${(segment.start_ms / 1000).toFixed(1)} seconds`}
                >
                  {(segment.start_ms / 1000).toFixed(1)}s
                </button>
                <div>
                  <p>{segment.corrected_text ?? segment.machine_text}</p>
                  {segment.corrected_text ? (
                    <p className="transcript-machine-text">
                      Machine text: {segment.machine_text}
                    </p>
                  ) : null}
                  {editing === segment.id ? (
                    <div className="grid gap-2">
                      <label
                        className="sr-only"
                        htmlFor={`correction-${segment.id}`}
                      >
                        Correct transcript segment
                      </label>
                      <textarea
                        id={`correction-${segment.id}`}
                        className="textarea"
                        value={correction}
                        maxLength={2000}
                        onChange={(event) => setCorrection(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={busy || !correction.trim()}
                          onClick={() => void saveCorrection(segment.id)}
                        >
                          Save correction
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => {
                        setEditing(segment.id);
                        setCorrection(
                          segment.corrected_text ?? segment.machine_text,
                        );
                      }}
                    >
                      Correct this segment
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-[var(--muted)]">
            Machine transcript · timing is approximate · corrections are stored
            separately and do not rewrite provider output.
          </p>
          <DeleteAiArtifactButton
            kind="transcript"
            artifactId={state.transcript.id}
            csrfToken={csrfToken}
          />
        </>
      )}
      {error ? (
        <div className="form-error mt-3" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
