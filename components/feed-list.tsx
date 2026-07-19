"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";

import { EntryCard } from "@/components/entry-card";
import { FragmentFocusRestorer } from "@/components/fragment-focus-restorer";
import { RestoreEntryButton } from "@/components/restore-entry-button";
import { StatusCard } from "@/components/status-card";
import type { FeedEntry } from "@/lib/database/types";

export function FeedList({
  initialEntries,
  initialCursor,
  csrfToken,
}: {
  initialEntries: FeedEntry[];
  initialCursor: string | null;
  csrfToken: string;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentlyTrashed, setRecentlyTrashed] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(
    async (automatic = false) => {
      if (!cursor || loading || !navigator.onLine) {
        if (!automatic && !navigator.onLine) {
          setError("Reconnect to load more Entries.");
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/feed?cursor=${encodeURIComponent(cursor)}`,
        );
        const result = (await response.json()) as {
          entries?: FeedEntry[];
          nextCursor?: string | null;
        };
        if (!response.ok || !result.entries) {
          throw new Error("The next page is temporarily unavailable.");
        }
        const nextEntries = result.entries;
        setEntries((current) => {
          const known = new Set(current.map((entry) => entry.entry_id));
          return [
            ...current,
            ...nextEntries.filter((entry) => !known.has(entry.entry_id)),
          ];
        });
        setCursor(result.nextCursor ?? null);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The next page is temporarily unavailable.",
        );
      } finally {
        setLoading(false);
      }
    },
    [cursor, loading],
  );

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) {
          void loadMore(true);
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  if (entries.length === 0 && !recentlyTrashed) {
    return (
      <StatusCard title="Your Feed is ready">
        Capture the first raw note above. Odiina keeps the occurrence time and
        preserves later edits as revisions.
      </StatusCard>
    );
  }

  return (
    <section aria-labelledby="feed-list-heading">
      <FragmentFocusRestorer />
      {recentlyTrashed ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--accent-soft)] p-4">
          <span className="text-sm font-semibold" role="status">
            Entry moved to Trash.
          </span>
          <RestoreEntryButton
            entryId={recentlyTrashed}
            csrfToken={csrfToken}
            onRestored={() => setRecentlyTrashed(null)}
          />
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="feed-list-heading"
          className="m-0 text-sm font-bold outline-none"
          tabIndex={-1}
        >
          Recent Entries
        </h2>
        <span className="text-xs text-[var(--muted)]">Newest first</span>
      </div>
      <div className="grid gap-3">
        {entries.map((entry) => (
          <EntryCard
            key={entry.entry_id}
            entry={entry}
            csrfToken={csrfToken}
            onRemoved={(entryId) => {
              setRecentlyTrashed(entryId);
              setEntries((current) =>
                current.filter((item) => item.entry_id !== entryId),
              );
              window.requestAnimationFrame(() => {
                document.getElementById("feed-list-heading")?.focus();
              });
            }}
          />
        ))}
      </div>

      <div ref={sentinel} className="mt-5 text-center">
        {error ? (
          <div className="form-error mb-3" role="alert">
            {error}
          </div>
        ) : null}
        {cursor ? (
          <Button
            className="button button-secondary"
            onPress={() => void loadMore(false)}
            isDisabled={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-sm text-[var(--muted)]">End of Feed</p>
        )}
      </div>
    </section>
  );
}
