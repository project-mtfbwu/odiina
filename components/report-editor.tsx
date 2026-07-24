"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { InsightListItem } from "@/lib/ai/types";
import type { ReportDetail } from "@/lib/reports/types";

export function ReportEditor({
  report,
  insights,
  aiEnabled,
  csrfToken,
}: {
  report: ReportDetail;
  insights: InsightListItem[];
  aiEnabled: boolean;
  csrfToken: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(report.title);
  const [introduction, setIntroduction] = useState(report.introduction);
  const [reflection, setReflection] = useState(report.closing_reflection);
  const [sections, setSections] = useState(report.sections);
  const [selectedEntries, setSelectedEntries] = useState(
    new Set(
      report.sources
        .filter((source) => source.selected)
        .map((source) => source.entry_id),
    ),
  );
  const [selectedMedia, setSelectedMedia] = useState(
    new Set(
      report.media
        .filter((media) => media.selected)
        .map((media) => media.attachment_id),
    ),
  );
  const [mediaOrder, setMediaOrder] = useState(report.media);
  const [coverAttachmentId, setCoverAttachmentId] = useState(
    report.media.find((media) => media.presentation_role === "cover")
      ?.attachment_id ?? "",
  );
  const [insightId, setInsightId] = useState(report.insight_id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function move(index: number, direction: -1 | 1) {
    const next = [...sections];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
  }

  function moveMedia(index: number, direction: -1 | 1) {
    const next = [...mediaOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setMediaOrder(next);
  }

  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/reports/${report.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          title,
          introduction,
          reflection,
          hiddenSections: sections
            .filter((section) => !section.visible)
            .map((section) => section.section_kind),
          sectionOrder: sections.map((section) => section.section_kind),
          selectedEntryIds: [...selectedEntries],
          selectedAttachmentIds: mediaOrder
            .filter((media) => selectedMedia.has(media.attachment_id))
            .map((media) => media.attachment_id),
          coverAttachmentId: coverAttachmentId || null,
          insightId: insightId || null,
        }),
      });
      const value = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(value.message ?? "Could not save this report.");
      setMessage(
        "Private report saved. Existing published snapshots were not changed.",
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this report.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <label className="field">
          <span className="field-label">Report title</span>
          <input
            className="input"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">User-authored introduction</span>
          <textarea
            className="input min-h-28"
            value={introduction}
            maxLength={4000}
            onChange={(event) => setIntroduction(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Closing reflection</span>
          <textarea
            className="input min-h-28"
            value={reflection}
            maxLength={4000}
            onChange={(event) => setReflection(event.target.value)}
          />
        </label>
      </div>
      <fieldset className="report-editor-group">
        <legend>Sections and reading order</legend>
        <p>
          Use the visible checkbox and Move controls; order never depends on
          drag-and-drop.
        </p>
        <ol className="report-order-list">
          {sections.map((section, index) => (
            <li key={section.id}>
              <label>
                <input
                  type="checkbox"
                  checked={section.visible}
                  onChange={(event) =>
                    setSections((current) =>
                      current.map((item) =>
                        item.id === section.id
                          ? { ...item, visible: event.target.checked }
                          : item,
                      ),
                    )
                  }
                />{" "}
                <span>{section.heading}</span>
              </label>
              <span className="flex gap-2">
                <button
                  className="text-button"
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={index === sections.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </button>
              </span>
            </li>
          ))}
        </ol>
      </fieldset>
      <fieldset className="report-editor-group">
        <legend>Source moments</legend>
        <p>
          Removing a moment affects this report only; the Entry remains
          unchanged.
        </p>
        <div className="grid gap-2">
          {report.sources.map((source) => (
            <label className="report-source-choice" key={source.entry_id}>
              <input
                type="checkbox"
                checked={selectedEntries.has(source.entry_id)}
                disabled={source.source_unavailable}
                onChange={(event) =>
                  setSelectedEntries((current) => {
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
                  {source.source_unavailable
                    ? "Unavailable or in Trash"
                    : source.body_excerpt || "Media moment"}
                </small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {report.media.length ? (
        <fieldset className="report-editor-group">
          <legend>Private media selection</legend>
          <p>
            Selected safe derivatives remain authenticated. Anonymous shares are
            text-only in this deployment.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {mediaOrder.map((media, index) => (
              <div className="report-source-choice" key={media.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedMedia.has(media.attachment_id)}
                    onChange={(event) => {
                      setSelectedMedia((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(media.attachment_id);
                        else next.delete(media.attachment_id);
                        return next;
                      });
                      if (
                        !event.target.checked &&
                        coverAttachmentId === media.attachment_id
                      )
                        setCoverAttachmentId("");
                    }}
                  />
                  <span>
                    <strong>{media.media_kind}</strong>
                    <small>Accepted private derivative</small>
                  </span>
                </label>
                {media.media_kind !== "audio" ? (
                  <label>
                    <input
                      type="radio"
                      name="report-cover"
                      checked={coverAttachmentId === media.attachment_id}
                      disabled={!selectedMedia.has(media.attachment_id)}
                      onChange={() => setCoverAttachmentId(media.attachment_id)}
                    />
                    Use as cover
                  </label>
                ) : null}
                <span className="flex gap-2">
                  <button
                    className="text-button"
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveMedia(index, -1)}
                  >
                    Move media up
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={index === mediaOrder.length - 1}
                    onClick={() => moveMedia(index, 1)}
                  >
                    Move media down
                  </button>
                </span>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="field">
        <span className="field-label">
          Optional evidence-backed AI narrative
        </span>
        <select
          className="input"
          value={insightId}
          onChange={(event) => setInsightId(event.target.value)}
        >
          <option value="">Factual only</option>
          {insights
            .filter(
              (insight) =>
                insight.status === "ready" &&
                insight.range_start === report.period_start &&
                insight.range_end === report.period_end,
            )
            .map((insight) => (
              <option
                value={insight.id}
                key={insight.id}
                disabled={!aiEnabled && insight.id !== report.insight_id}
              >
                {insight.title}
              </option>
            ))}
        </select>
        <small>
          {aiEnabled
            ? "Choose a matching ready private insight. Attaching it preserves your authored text."
            : "AI is off. Existing attached narrative can remain or be removed; enable Master AI and Insights consent before attaching a new one."}
        </small>
      </label>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <p aria-live="polite">{message}</p>
      <button
        className="button button-primary justify-self-start"
        type="button"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save private report"}
      </button>
    </div>
  );
}
