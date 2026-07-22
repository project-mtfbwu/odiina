import Link from "next/link";

import type { EntryTag } from "@/lib/database/types";

export function TagChips({
  tags,
  compact = false,
  searchable = true,
  includeTrash = false,
}: {
  tags: EntryTag[];
  compact?: boolean;
  searchable?: boolean;
  includeTrash?: boolean;
}) {
  if (tags.length === 0) return null;
  const visible = compact ? tags.slice(0, 3) : tags;
  return (
    <div className="tag-chip-list" aria-label="Entry tags">
      {visible.map((tag) =>
        searchable ? (
          <Link
            key={tag.tag_id}
            className="tag-chip tag-chip-link"
            href={`/search?tag=${encodeURIComponent(tag.display_name)}${includeTrash ? "&includeTrash=1" : ""}&sort=newest`}
          >
            {tag.display_name}
          </Link>
        ) : (
          <span key={tag.tag_id} className="tag-chip">
            {tag.display_name}
          </span>
        ),
      )}
      {compact && tags.length > visible.length ? (
        <span className="tag-chip tag-chip-more">
          +{tags.length - visible.length} more tags
        </span>
      ) : null}
    </div>
  );
}
