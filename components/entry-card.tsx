import Link from "next/link";

import { entryPreview } from "@/components/entry-preview";
import { EntryMedia } from "@/components/entry-media";
import { ImageIcon, LockIcon, MicrophoneIcon } from "@/components/icons";
import { TrashEntryButton } from "@/components/trash-entry-button";
import { VoicePlayer } from "@/components/voice-player";
import type { FeedEntry } from "@/lib/database/types";

function formatOccurrence(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function EntryCard({
  entry,
  csrfToken,
  displayName,
  onRemoved,
}: {
  entry: FeedEntry;
  csrfToken: string;
  displayName: string;
  onRemoved?: (entryId: string) => void;
}) {
  const imageCount = entry.media.filter(
    (item) => item.media_kind === "image",
  ).length;
  const hasVoice = entry.media.some((item) => item.media_kind === "audio");
  return (
    <article
      className="entry-card"
      id={`entry-${entry.entry_id}`}
      tabIndex={-1}
    >
      <div className="entry-card-header">
        <div className="avatar avatar-small" aria-hidden="true">
          {displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase()}
        </div>
        <div className="entry-identity">
          <p>{displayName}</p>
          <time dateTime={entry.occurred_at}>
            {formatOccurrence(entry.occurred_at, entry.occurred_timezone)}
          </time>
        </div>
        <div className="entry-badges">
          {imageCount ? (
            <span>
              <ImageIcon className="size-4" /> Image
            </span>
          ) : null}
          {hasVoice ? (
            <span>
              <MicrophoneIcon className="size-4" /> Voice
            </span>
          ) : null}
          {!imageCount && !hasVoice ? <span>Text</span> : null}
          {entry.revision_number > 1 ? <span>Edited</span> : null}
          {new Date(entry.created_at).getTime() >
          new Date(entry.occurred_at).getTime() + 60_000 ? (
            <span>Recorded later</span>
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
        className="entry-body"
        aria-label={`Open Entry from ${formatOccurrence(
          entry.occurred_at,
          entry.occurred_timezone,
        )}`}
      >
        <span className="line-clamp-4 sm:line-clamp-5">
          {entry.body_text
            ? entryPreview(entry.body_text)
            : hasVoice && imageCount
              ? `Voice note with ${imageCount} ${imageCount === 1 ? "photo" : "photos"}`
              : hasVoice
                ? "Private voice note"
                : `${imageCount} ${imageCount === 1 ? "photo" : "photos"}`}
        </span>
      </Link>
      {entry.media.length > 0 ? (
        <div className="entry-media">
          <EntryMedia media={entry.media} compact />
          <VoicePlayer media={entry.media} compact />
        </div>
      ) : null}
      <div className="entry-footer">
        <span className="entry-private">
          <LockIcon className="size-4" />
          Private · Revision {entry.revision_number}
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
