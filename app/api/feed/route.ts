import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { feedPageSize } from "@/lib/database/queries";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/database/cursor";
import type {
  EntryMedia,
  EntryPlace,
  EntryTag,
  FeedEntry,
} from "@/lib/database/types";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

export async function GET(request: NextRequest) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }

  const cursor = decodeFeedCursor(request.nextUrl.searchParams.get("cursor"));
  const { data, error } = await context.supabase
    .schema("app")
    .rpc("feed_page", {
      p_cursor_entry_id: cursor?.entryId ?? null,
      p_cursor_occurred_at: cursor?.occurredAt ?? null,
      p_include_trash: false,
      p_limit: feedPageSize,
    });

  if (error) {
    return context.applyAuthState(
      NextResponse.json({ error: "feed_unavailable" }, { status: 503 }),
    );
  }

  const rawEntries = (data ?? []) as Omit<
    FeedEntry,
    "media" | "place" | "tags"
  >[];
  const revisionIds = rawEntries.map((entry) => entry.current_revision_id);
  const { data: mediaData, error: mediaError } = revisionIds.length
    ? await context.supabase
        .schema("app")
        .rpc("revision_media", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (mediaError) {
    return context.applyAuthState(
      NextResponse.json({ error: "feed_unavailable" }, { status: 503 }),
    );
  }
  const media = (mediaData ?? []) as (EntryMedia & {
    revision_id: string;
  })[];
  const { data: placeData, error: placeError } = revisionIds.length
    ? await context.supabase
        .schema("app")
        .rpc("revision_places", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (placeError) {
    return context.applyAuthState(
      NextResponse.json({ error: "feed_unavailable" }, { status: 503 }),
    );
  }
  const places = (placeData ?? []) as (EntryPlace & {
    revision_id: string;
  })[];
  const { data: tagData, error: tagError } = revisionIds.length
    ? await context.supabase
        .schema("app")
        .rpc("revision_tags", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (tagError) {
    return context.applyAuthState(
      NextResponse.json({ error: "feed_unavailable" }, { status: 503 }),
    );
  }
  const tags = (tagData ?? []) as (EntryTag & { revision_id: string })[];
  const entries: FeedEntry[] = rawEntries.map((entry) => ({
    ...entry,
    media: media
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.media_position - b.media_position),
    place:
      places.find(
        (item) =>
          item.revision_id === entry.current_revision_id && !item.redacted_at,
      ) ?? null,
    tags: tags
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.tag_position - b.tag_position),
  }));
  const last = entries.at(-1);
  return context.applyAuthState(
    NextResponse.json({
      entries,
      nextCursor:
        entries.length === feedPageSize && last
          ? encodeFeedCursor({
              entryId: last.entry_id,
              occurredAt: last.occurred_at,
            })
          : null,
    }),
  );
}
