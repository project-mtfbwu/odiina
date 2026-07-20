import Link from "next/link";

import { entryPreview } from "@/components/entry-preview";
import { EntryMedia } from "@/components/entry-media";
import { TrashEntryButton } from "@/components/trash-entry-button";
import type { FeedEntry } from "@/lib/database/types";

function formatOccurrence(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function EntryCard({
  entry,
  csrfToken,
  onRemoved,
}: {
  entry: FeedEntry;
  csrfToken: string;
  onRemoved?: (entryId: string) => void;
}) {
  return (
    <article
      className="panel group relative p-4 outline-none sm:p-5"
      id={`entry-${entry.entry_id}`}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <time
            dateTime={entry.occurred_at}
            className="text-xs font-bold tracking-[0.03em] text-[var(--muted)]"
          >
            {formatOccurrence(entry.occurred_at, entry.occurred_timezone)}
          </time>
          {entry.revision_number > 1 ? (
            <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[0.68rem] font-bold text-[#49399a]">
              Edited
            </span>
          ) : null}
        </div>
        <TrashEntryButton
          entryId={entry.entry_id}
          csrfToken={csrfToken}
          onRemoved={onRemoved}
        />
      </div>
      <Link
        href={`/entries/${entry.entry_id}`}
        className="mt-3 block rounded-lg text-[0.98rem] leading-7 whitespace-pre-wrap text-[var(--ink)] no-underline sm:text-base"
        aria-label={`Open Entry from ${formatOccurrence(
          entry.occurred_at,
          entry.occurred_timezone,
        )}`}
      >
        <span className="line-clamp-4 sm:line-clamp-5">
          {entry.body_text
            ? entryPreview(entry.body_text)
            : `${entry.media.length} ${entry.media.length === 1 ? "photo" : "photos"}`}
        </span>
      </Link>
      {entry.media.length > 0 ? (
        <div className="mt-3">
          <EntryMedia media={entry.media} compact />
        </div>
      ) : null}
      <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3">
        <span className="text-xs text-[var(--muted)]">
          Revision {entry.revision_number}
        </span>
        <Link
          href={`/entries/${entry.entry_id}?mode=edit`}
          className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-bold text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
        >
          Edit Entry
        </Link>
      </div>
    </article>
  );
}
