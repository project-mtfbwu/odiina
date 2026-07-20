"use client";

import { useState } from "react";

import type { EntryMedia as EntryMediaItem } from "@/lib/database/types";

export function EntryMedia({
  media,
  trash = false,
  compact = false,
}: {
  media: EntryMediaItem[];
  trash?: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  if (media.length === 0) return null;
  return (
    <div
      className={`grid gap-2 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
      aria-label={`${media.length} attached ${media.length === 1 ? "image" : "images"}`}
    >
      {media.map((item, index) =>
        failed.has(item.attachment_id) ? (
          <div
            key={item.attachment_id}
            className="flex aspect-video min-h-28 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-center text-sm text-[var(--muted)]"
            role="img"
            aria-label={`Attached image ${index + 1} could not be loaded`}
          >
            Image unavailable
          </div>
        ) : (
          // The authenticated media route always returns a stripped JPEG.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.attachment_id}
            src={`/api/media/${item.attachment_id}${trash ? "?scope=trash" : ""}`}
            alt={`Attached image ${index + 1} of ${media.length}`}
            width={item.width}
            height={item.height}
            loading="lazy"
            onError={() =>
              setFailed((current) => new Set(current).add(item.attachment_id))
            }
            className={`w-full rounded-xl bg-[var(--surface-raised)] object-cover ${
              compact ? "max-h-72" : "max-h-[42rem]"
            }`}
          />
        ),
      )}
    </div>
  );
}
