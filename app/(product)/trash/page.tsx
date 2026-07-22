import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { RestoreEntryButton } from "@/components/restore-entry-button";
import { EntryMedia } from "@/components/entry-media";
import { StatusCard } from "@/components/status-card";
import { VoicePlayer } from "@/components/voice-player";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getFeedPage } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Trash" };
export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function mediaSummary(
  media: Awaited<ReturnType<typeof getFeedPage>>["entries"][number]["media"],
) {
  const images = media.filter((item) => item.media_kind === "image").length;
  const hasVoice = media.some((item) => item.media_kind === "audio");
  return [
    images > 0 ? `${images} ${images === 1 ? "photo" : "photos"}` : null,
    hasVoice ? "Voice note" : null,
  ]
    .filter(Boolean)
    .join(" and ");
}

export default async function TrashPage() {
  const [feed, cookieStore] = await Promise.all([
    getFeedPage(null, true),
    cookies(),
  ]);
  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";

  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recoverable deletion</p>
          <h1 className="page-title">Trash</h1>
          <p className="page-description">
            Trashed Entries are hidden from your Feed and can be restored before
            their purge date.
          </p>
        </div>
      </header>

      {feed.entries.length === 0 ? (
        <StatusCard
          title="Trash is empty"
          action={
            <Link className="button button-secondary" href="/feed">
              Return to Feed
            </Link>
          }
        >
          Entries moved to Trash will appear here until the future deletion
          coordinator removes them.
        </StatusCard>
      ) : (
        <div className="grid gap-3">
          {feed.entries.map((entry) => (
            <article className="panel p-4 sm:p-5" key={entry.entry_id}>
              <p className="m-0 line-clamp-4 leading-7 whitespace-pre-wrap">
                {entry.body_text || mediaSummary(entry.media)}
              </p>
              {entry.media.length > 0 ? (
                <div className="mt-3">
                  <EntryMedia media={entry.media} trash compact />
                  <VoicePlayer media={entry.media} trash compact />
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--line)] pt-4">
                <div className="text-xs leading-5 text-[var(--muted)]">
                  <div>Occurred {formatDate(entry.occurred_at)}</div>
                  <div>Scheduled purge date is shown on Entry detail.</div>
                </div>
                <RestoreEntryButton entryId={entry.entry_id} csrfToken={csrf} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
