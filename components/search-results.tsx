"use client";

import Link from "next/link";
import { useState } from "react";

import { EntryCard } from "@/components/entry-card";
import { StatusCard } from "@/components/status-card";
import type { FeedEntry } from "@/lib/database/types";

export function SearchResults({
  initialEntries,
  csrfToken,
  displayName,
  includeTrash,
  nextPageHref,
}: {
  initialEntries: FeedEntry[];
  csrfToken: string;
  displayName: string;
  includeTrash: boolean;
  nextPageHref: string | null;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const removeEntry = (entryId: string) => {
    setEntries((current) =>
      current.filter((entry) => entry.entry_id !== entryId),
    );
  };

  return (
    <section
      className="search-results"
      aria-labelledby="search-results-heading"
    >
      <div className="search-results-heading">
        <div>
          <p className="eyebrow">Authorized current snapshots</p>
          <h2 id="search-results-heading">Search results</h2>
        </div>
        <p role="status" aria-live="polite">
          {entries.length} {entries.length === 1 ? "result" : "results"}
          {includeTrash ? ", including Trash" : ", active only"}
        </p>
      </div>
      {entries.length ? (
        <div className="feed-list">
          {entries.map((entry) => (
            <EntryCard
              key={entry.entry_id}
              entry={entry}
              csrfToken={csrfToken}
              displayName={displayName}
              onRemoved={removeEntry}
              onRestored={removeEntry}
            />
          ))}
        </div>
      ) : (
        <StatusCard title="No matching Entries remain">
          The Entry state changed successfully. Adjust the filters or search
          again to refresh this private result set.
        </StatusCard>
      )}
      {entries.length && nextPageHref ? (
        <Link
          className="button button-secondary search-load-more"
          href={nextPageHref}
        >
          Load more results
        </Link>
      ) : entries.length ? (
        <p className="search-end-state">End of matching results</p>
      ) : null}
    </section>
  );
}
