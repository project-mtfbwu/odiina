import "server-only";

import { notFound } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/server-client";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/database/cursor";
import type {
  EntryDetail,
  EntryMedia,
  FeedEntry,
  UserPreferences,
} from "@/lib/database/types";

export const feedPageSize = 24;

export type FeedPage = {
  entries: FeedEntry[];
  nextCursor: string | null;
};

export async function getFeedPage(
  encodedCursor: string | null,
  includeTrash = false,
): Promise<FeedPage> {
  const cursor = decodeFeedCursor(encodedCursor);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("feed_page", {
    p_cursor_entry_id: cursor?.entryId ?? null,
    p_cursor_occurred_at: cursor?.occurredAt ?? null,
    p_include_trash: includeTrash,
    p_limit: feedPageSize,
  });

  if (error) {
    throw new Error("feed_read_failed", { cause: error });
  }

  const rawEntries = (data ?? []) as Omit<FeedEntry, "media">[];
  const revisionIds = rawEntries.map((entry) => entry.current_revision_id);
  const { data: mediaRows, error: mediaError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_media", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (mediaError) {
    throw new Error("feed_media_read_failed", { cause: mediaError });
  }
  const media = (mediaRows ?? []) as (EntryMedia & {
    revision_id: string;
  })[];
  const entries: FeedEntry[] = rawEntries.map((entry) => ({
    ...entry,
    media: media
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.media_position - b.media_position),
  }));
  const lastEntry = entries.at(-1);
  const nextCursor =
    entries.length === feedPageSize && lastEntry
      ? encodeFeedCursor({
          entryId: lastEntry.entry_id,
          occurredAt: lastEntry.occurred_at,
        })
      : null;

  return { entries, nextCursor };
}

export async function getPreferences(): Promise<UserPreferences> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .from("user_preferences")
    .select("locale,iana_timezone,week_starts_on")
    .single();

  if (error) {
    throw new Error("preferences_read_failed", { cause: error });
  }

  return data as UserPreferences;
}

export async function getEntryDetail(entryId: string): Promise<EntryDetail> {
  const supabase = await createSupabaseServerClient();
  const { data: entry, error: entryError } = await supabase
    .schema("app")
    .from("entries")
    .select(
      "id,current_revision_id,lifecycle_state,created_at,updated_at,trashed_at,purge_after",
    )
    .eq("id", entryId)
    .single();

  if (entryError || !entry) {
    notFound();
  }

  const { data: revisions, error: revisionError } = await supabase
    .schema("app")
    .from("entry_revisions")
    .select(
      "id,revision_number,body_text,occurred_at,occurred_timezone,occurred_local_date,occurred_utc_offset_minutes,change_reason,created_at",
    )
    .eq("entry_id", entryId)
    .order("revision_number", { ascending: false });

  if (revisionError) {
    throw new Error("entry_history_failed", { cause: revisionError });
  }

  const revisionIds = (revisions ?? []).map((revision) => revision.id);
  const { data: mediaRows, error: mediaError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_media", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (mediaError) {
    throw new Error("entry_media_history_failed", { cause: mediaError });
  }
  const media = (mediaRows ?? []) as (EntryMedia & {
    revision_id: string;
  })[];

  return {
    ...(entry as Omit<EntryDetail, "revisions">),
    revisions: (revisions ?? []).map((revision) => ({
      ...revision,
      media: media
        .filter((item) => item.revision_id === revision.id)
        .sort((a, b) => a.media_position - b.media_position),
    })),
  };
}
