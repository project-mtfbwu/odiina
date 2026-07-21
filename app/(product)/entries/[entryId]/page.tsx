import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { EntryEditor } from "@/components/entry-editor";
import { EntryMedia } from "@/components/entry-media";
import { RestoreEntryButton } from "@/components/restore-entry-button";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getEntryDetail, getPreferences } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Entry" };
export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ entryId }, query, preferences, cookieStore] = await Promise.all([
    params,
    searchParams,
    getPreferences(),
    cookies(),
  ]);
  const entry = await getEntryDetail(entryId);
  const current = entry.revisions.find(
    (revision) => revision.id === entry.current_revision_id,
  );

  if (!current) {
    throw new Error("entry_current_revision_missing");
  }

  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";
  const editing = query.mode === "edit" && entry.lifecycle_state === "active";

  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <Link
            className="back-link"
            href={`/feed#entry-${entryId}`}
            id="entry-back-link"
          >
            ← Back to Feed
          </Link>
          <p className="eyebrow mt-5">
            {entry.lifecycle_state === "trashed"
              ? "Trashed Entry"
              : "Entry detail"}
          </p>
          <h1 className="page-title">{current.occurred_local_date}</h1>
          <p className="page-description">
            Happened{" "}
            <time dateTime={current.occurred_at}>
              {new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: current.occurred_timezone,
              }).format(new Date(current.occurred_at))}
            </time>
            {" · "}Revision {current.revision_number}
          </p>
          <p className="trace-time">
            Recorded{" "}
            <time dateTime={entry.created_at}>
              {new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone:
                  preferences.iana_timezone ?? current.occurred_timezone,
              }).format(new Date(entry.created_at))}
            </time>
            {new Date(entry.created_at).getTime() >
            new Date(current.occurred_at).getTime() + 60_000
              ? " · Recorded later"
              : ""}
          </p>
        </div>
        {!editing && entry.lifecycle_state === "active" ? (
          <Link
            className="button button-primary"
            href={`/entries/${entryId}?mode=edit`}
          >
            Edit Entry
          </Link>
        ) : null}
      </header>

      {editing ? (
        <EntryEditor
          entryId={entryId}
          currentRevisionId={entry.current_revision_id}
          initialBody={current.body_text}
          initialOccurredAt={current.occurred_at}
          initialOccurredTimezone={current.occurred_timezone}
          initialOccurredLocalDate={current.occurred_local_date}
          initialOccurredUtcOffsetMinutes={current.occurred_utc_offset_minutes}
          timezone={preferences.iana_timezone ?? current.occurred_timezone}
          csrfToken={csrf}
          currentMedia={current.media}
        />
      ) : (
        <article className="panel p-5 sm:p-7">
          {current.body_text ? (
            <p className="entry-body whitespace-pre-wrap">
              {current.body_text}
            </p>
          ) : null}
          {current.media.length > 0 ? (
            <div className={current.body_text ? "mt-5" : ""}>
              <EntryMedia
                media={current.media}
                trash={entry.lifecycle_state === "trashed"}
              />
            </div>
          ) : null}
          {entry.lifecycle_state === "trashed" ? (
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <p className="text-sm text-[var(--muted)]">
                Scheduled for permanent deletion after{" "}
                <strong>
                  {entry.purge_after?.slice(0, 10) ?? "the retention period"}
                </strong>
                . Permanent deletion is not implemented in this slice.
              </p>
              <RestoreEntryButton entryId={entryId} csrfToken={csrf} />
            </div>
          ) : null}
        </article>
      )}

      <section
        className="panel mt-4 p-5 sm:p-7"
        aria-labelledby="history-heading"
      >
        <h2 id="history-heading" className="mt-0 text-xl font-bold">
          Revision history
        </h2>
        <ol className="m-0 grid list-none gap-4 p-0">
          {entry.revisions.map((revision) => (
            <li
              key={revision.id}
              className="rounded-xl border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-sm font-bold">
                  Revision {revision.revision_number}
                  {revision.id === entry.current_revision_id
                    ? " · Current"
                    : ""}
                </h3>
                <time
                  className="text-xs text-[var(--muted)]"
                  dateTime={revision.created_at}
                >
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(revision.created_at))}
                </time>
              </div>
              <p className="mt-3 mb-0 text-sm leading-6 whitespace-pre-wrap">
                {revision.body_text}
              </p>
              <p className="revision-occurrence">
                Happened{" "}
                <time dateTime={revision.occurred_at}>
                  {new Intl.DateTimeFormat("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: revision.occurred_timezone,
                  }).format(new Date(revision.occurred_at))}
                </time>
                {" · "}
                {revision.change_reason === "occurrence_corrected"
                  ? "Occurrence corrected"
                  : revision.change_reason === "created"
                    ? "Created"
                    : "Content edited"}
              </p>
              {revision.media.length > 0 ? (
                <div className="mt-3">
                  <EntryMedia
                    media={revision.media}
                    trash={entry.lifecycle_state === "trashed"}
                    compact
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
