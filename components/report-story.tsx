import Link from "next/link";
import { Fragment } from "react";

import type { ReportDetail } from "@/lib/reports/types";

const metricLabels: Record<string, string> = {
  entries: "Entries",
  active_days: "Active days",
  text_entries: "Text Entries",
  photo_entries: "Photo Entries",
  voice_entries: "Voice notes",
  voice_duration_ms: "Voice duration",
  video_entries: "Videos",
  video_duration_ms: "Video duration",
  place_entries: "Places",
  tagged_entries: "Tagged Entries",
  edited_entries: "Edited Entries",
};

function metricValue(key: string, value: number) {
  return key.endsWith("_duration_ms")
    ? `${Math.round(value / 60_000)} min`
    : value.toLocaleString();
}

function monthLabel(civilDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${civilDate}T12:00:00Z`));
}

export function ReportStory({
  report,
  print = false,
}: {
  report: ReportDetail;
  print?: boolean;
}) {
  const visible = new Map(
    report.sections
      .filter((section) => section.visible)
      .map((section) => [section.section_kind, section]),
  );
  const sources = report.sources.filter((source) => source.selected);
  const media = report.media.filter(
    (item) =>
      item.selected &&
      ((item.media_kind === "image" && visible.has("photos")) ||
        (item.media_kind === "audio" && visible.has("voice")) ||
        (item.media_kind === "video" && visible.has("video"))),
  );
  const coverMedia = media.find(
    (item) => item.presentation_role === "cover" && item.media_kind !== "audio",
  );
  return (
    <article
      className={`report-story report-story-${report.report_type} ${print ? "report-print" : ""}`}
    >
      <header className="report-cover">
        {coverMedia ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="report-cover-media"
              src={
                coverMedia.media_kind === "video"
                  ? `/api/media/${coverMedia.attachment_id}?variant=poster`
                  : `/api/media/${coverMedia.attachment_id}`
              }
              alt="Selected private report cover"
            />
          </>
        ) : null}
        <p className="eyebrow">
          {report.report_type === "yearly"
            ? "Private yearly story"
            : "Private recap"}
        </p>
        <h1>{report.title}</h1>
        <p>
          {report.period_start} — {report.period_end}
        </p>
        <div className="report-status-row">
          <span>
            {report.generation_mode === "ai_enhanced"
              ? "AI-enhanced · evidence linked"
              : "Factual · no AI required"}
          </span>
          <span>
            {report.status === "stale"
              ? "Sources changed · review needed"
              : "Private snapshot"}
          </span>
        </div>
        {visible.has("cover") && report.introduction ? (
          <p className="report-introduction">{report.introduction}</p>
        ) : null}
      </header>
      {visible.has("at_a_glance") ? (
        <section className="story-section">
          <h2>{visible.get("at_a_glance")!.heading}</h2>
          <dl className="metric-grid">
            {report.metrics.map((metric) => (
              <div key={metric.metric_key}>
                <dt>{metricLabels[metric.metric_key] ?? metric.metric_key}</dt>
                <dd>{metricValue(metric.metric_key, metric.metric_value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {visible.has("key_moments") &&
      visible.get("key_moments")!.generated_text ? (
        <section className="story-section ai-story-section">
          <p className="eyebrow">Optional AI narrative</p>
          <h2>{visible.get("key_moments")!.heading}</h2>
          <p>{visible.get("key_moments")!.generated_text}</p>
          {report.citations.length ? (
            <div className="report-citations">
              <h3>Evidence citations</h3>
              <ol>
                {report.citations.map((citation) => (
                  <li key={citation.id}>
                    <Link href={`/entries/${citation.entry_id}`}>
                      {citation.occurred_local_date} · Open accepted Entry
                      revision
                    </Link>
                    <p>
                      {citation.evidence_excerpt}
                      {citation.start_ms !== null
                        ? ` · ${(citation.start_ms / 1000).toFixed(1)}–${((citation.end_ms ?? citation.start_ms) / 1000).toFixed(1)} seconds`
                        : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <p className="report-source-note">
            AI-generated text may be wrong. It is retained separately from
            user-authored reflection.
          </p>
        </section>
      ) : null}
      {visible.has("timeline") ? (
        <section className="story-section">
          <h2>{visible.get("timeline")!.heading}</h2>
          {sources.length ? (
            <ol className="story-timeline">
              {sources.map((source, index) => (
                <Fragment key={source.entry_id}>
                  {report.report_type === "yearly" &&
                  (index === 0 ||
                    sources[index - 1].occurred_local_date.slice(0, 7) !==
                      source.occurred_local_date.slice(0, 7)) ? (
                    <li className="story-timeline-chapter">
                      <h3>{monthLabel(source.occurred_local_date)}</h3>
                    </li>
                  ) : null}
                  <li data-unavailable={source.source_unavailable || undefined}>
                    <time dateTime={source.occurred_at}>
                      {source.occurred_local_date}
                    </time>
                    <div>
                      {source.source_unavailable ? (
                        <p>Source unavailable or in Trash.</p>
                      ) : (
                        <>
                          <p>{source.body_excerpt || "Media moment"}</p>
                          {visible.has("places") && source.place_label ? (
                            <span className="story-place">
                              Place label: {source.place_label}
                            </span>
                          ) : null}
                          {!print ? (
                            <Link href={`/entries/${source.entry_id}`}>
                              Open private source
                            </Link>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                </Fragment>
              ))}
            </ol>
          ) : (
            <p>No source moments selected.</p>
          )}
        </section>
      ) : null}
      {media.length ? (
        <section className="story-section">
          <h2>Selected private media</h2>
          <div className="story-media-grid">
            {media.map((item) => (
              <figure key={item.id}>
                {item.media_kind === "image" ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${item.attachment_id}`}
                      alt="Selected private report photo"
                      loading="lazy"
                    />
                  </>
                ) : item.media_kind === "audio" ? (
                  <audio
                    controls
                    preload="none"
                    src={`/api/media/${item.attachment_id}`}
                    aria-label="Selected private voice note"
                  />
                ) : (
                  <video
                    controls
                    preload="none"
                    playsInline
                    poster={`/api/media/${item.attachment_id}?variant=poster`}
                    src={`/api/media/${item.attachment_id}`}
                    aria-label="Selected private video"
                  />
                )}
                <figcaption>
                  {item.media_kind} · authenticated safe derivative · no
                  autoplay
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="print-media-note">
            Playable audio and video are omitted from printed output.
          </p>
        </section>
      ) : null}
      {visible.has("tags") && report.tags.length ? (
        <section className="story-section">
          <h2>{visible.get("tags")!.heading}</h2>
          <ul className="report-story-tags" aria-label="Tags in this report">
            {report.tags.map((tag) => (
              <li key={tag.normalized_name}>
                <span>#{tag.display_name}</span>
                <small>
                  {tag.entry_count}{" "}
                  {tag.entry_count === 1 ? "Entry" : "Entries"}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {visible.has("reflection") && report.closing_reflection ? (
        <section className="story-section story-reflection">
          <h2>{visible.get("reflection")!.heading}</h2>
          <p>{report.closing_reflection}</p>
        </section>
      ) : null}
      <footer className="report-story-footer">
        <strong>Odiina</strong>
        <span>Private derived artifact · sources remain authoritative</span>
      </footer>
    </article>
  );
}
