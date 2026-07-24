"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  customPeriod,
  periodForDate,
  type ReportPeriod,
  type ReportType,
} from "@/lib/reports/periods";

type Preview = {
  entry_count: number;
  active_days: number;
  photo_entries: number;
  voice_entries: number;
  video_entries: number;
  place_entries: number;
  tagged_entries: number;
  sources: Array<{
    entry_id: string;
    occurred_local_date: string;
    body_text: string;
    has_image: boolean;
    has_audio: boolean;
    has_video: boolean;
    has_place: boolean;
    tag_normalized_names: string[];
  }>;
};

export function ReportCreator({
  csrfToken,
  weekStartsOn,
  initialDate,
}: {
  csrfToken: string;
  weekStartsOn: number;
  initialDate: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<ReportType>("monthly");
  const [date, setDate] = useState(initialDate);
  const [customEnd, setCustomEnd] = useState(initialDate);
  const [includePlaces, setIncludePlaces] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const period = useMemo<ReportPeriod | null>(() => {
    try {
      return type === "custom"
        ? customPeriod(date, customEnd)
        : periodForDate(type, date, weekStartsOn);
    } catch {
      return null;
    }
  }, [type, date, customEnd, weekStartsOn]);

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
      throw new Error(value.message ?? "The report request failed.");
    return value.result;
  }

  const scope = {
    reportType: type,
    start: period?.start ?? "",
    end: period?.end ?? "",
    entryIds: [...selectedEntryIds],
  };

  async function previewReport() {
    if (!period) {
      setError("Choose a valid civil date range of no more than 367 days.");
      return;
    }
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const next = (await call("/api/reports/preview", {
        ...scope,
        entryIds: [],
      })) as Preview;
      setPreview(next);
      setSelectedEntryIds(
        new Set(next.sources.map((source) => source.entry_id)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not preview this report.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createReport() {
    if (!preview || !period) return;
    setBusy(true);
    setError("");
    try {
      const result = (await call("/api/reports", {
        ...scope,
        title: period.label,
        includePlaces,
        clientRequestId: crypto.randomUUID(),
      })) as { report_id: string };
      router.push(`/reports/${result.report_id}/edit`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create this report.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <label className="field">
        <span className="field-label">Recap type</span>
        <select
          className="input"
          value={type}
          onChange={(event) => {
            setType(event.target.value as ReportType);
            setPreview(null);
          }}
        >
          <option value="daily">Daily recap</option>
          <option value="weekly">Weekly recap</option>
          <option value="monthly">Monthly recap</option>
          <option value="yearly">Yearly story</option>
          <option value="custom">Custom report</option>
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field">
          <span className="field-label">
            {type === "custom" ? "From" : "Date inside period"}
          </span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        {type === "custom" ? (
          <label className="field">
            <span className="field-label">To</span>
            <input
              className="input"
              type="date"
              min={date}
              value={customEnd}
              onChange={(event) => {
                setCustomEnd(event.target.value);
                setPreview(null);
              }}
            />
          </label>
        ) : null}
      </div>
      {period ? (
        <div className="report-period-summary">
          <strong>{period.label}</strong>
          <span>
            {period.start} to {period.end}
          </span>
        </div>
      ) : (
        <div className="form-error" role="alert">
          Choose a valid civil date range of no more than 367 days.
        </div>
      )}
      <label className="ai-choice">
        <input
          type="checkbox"
          checked={includePlaces}
          onChange={(event) => setIncludePlaces(event.target.checked)}
        />
        <span>
          <strong>Include confirmed place labels in the private draft</strong>
          <small>
            Off by default. Exact and approximate coordinates are always
            excluded.
          </small>
        </span>
      </label>
      {preview ? (
        <>
          <div className="report-preview" role="status">
            <strong>
              {preview.entry_count} Entries across {preview.active_days} active
              days
            </strong>
            <span>
              {preview.photo_entries} photo · {preview.voice_entries} voice ·{" "}
              {preview.video_entries} video · {preview.place_entries} place ·{" "}
              {preview.tagged_entries} tagged
            </span>
            <small>Factual preview only. No provider request occurred.</small>
          </div>
          <fieldset className="report-editor-group">
            <legend>Select active source Entries</legend>
            <p>
              Up to 200 current Entries can be frozen. Trash and historical
              revisions are excluded.
            </p>
            {preview.sources.length ? (
              <div className="grid gap-2">
                {preview.sources.map((source) => (
                  <label className="report-source-choice" key={source.entry_id}>
                    <input
                      type="checkbox"
                      checked={selectedEntryIds.has(source.entry_id)}
                      onChange={(event) =>
                        setSelectedEntryIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(source.entry_id);
                          else next.delete(source.entry_id);
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{source.occurred_local_date}</strong>
                      <small>
                        {source.body_text || "Media or place moment"}
                      </small>
                      <small>
                        {[
                          source.has_image && "photo",
                          source.has_audio && "voice",
                          source.has_video && "video",
                          source.has_place && "place",
                          ...source.tag_normalized_names.map(
                            (tag) => `#${tag}`,
                          ),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "text"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p>No active Entries occur in this period.</p>
            )}
          </fieldset>
        </>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="button button-secondary"
          type="button"
          disabled={busy || !period}
          onClick={() => void previewReport()}
        >
          Preview sources
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !preview}
          onClick={() => void createReport()}
        >
          {busy ? "Working…" : "Create private draft"}
        </button>
      </div>
    </div>
  );
}
