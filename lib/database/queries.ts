import "server-only";

import { notFound } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/server-client";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/database/cursor";
import type {
  CalendarActivity,
  EntryDetail,
  EntryMedia,
  EntryPlace,
  EntryTag,
  FeedEntry,
  PrivateProfile,
  ProfileStatistics,
  TagCollection,
  UserPreferences,
} from "@/lib/database/types";
import { isValidCivilDate, monthStart } from "@/lib/calendar/civil-date";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  searchScope,
  type SearchParameters,
} from "@/lib/search/parameters";

export const feedPageSize = 24;

export type FeedPage = {
  entries: FeedEntry[];
  nextCursor: string | null;
};

export type CalendarDayPage = FeedPage;

type RevisionPlaceRow = EntryPlace & { revision_id: string };
type RevisionTagRow = EntryTag & { revision_id: string };

export type TagSuggestion = EntryTag & { active_usage: number };
export type SearchPage = FeedPage;

function normalizePlace(row: RevisionPlaceRow | undefined): EntryPlace | null {
  if (!row) return null;
  return {
    ...row,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    approximate_radius_meters:
      row.approximate_radius_meters === null
        ? null
        : Number(row.approximate_radius_meters),
  };
}

export async function getCalendarMonthActivity(
  selectedDate: string,
): Promise<CalendarActivity[]> {
  if (!isValidCivilDate(selectedDate)) throw new Error("calendar_date_invalid");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("calendar_month_activity", {
      p_month_start: monthStart(selectedDate),
    });
  if (error) throw new Error("calendar_month_read_failed", { cause: error });
  return (data ?? []).map(
    (row: { occurred_local_date: string; entry_count: number | string }) => ({
      occurred_local_date: String(row.occurred_local_date),
      entry_count: Number(row.entry_count),
    }),
  );
}

export async function getCalendarDayPage(
  selectedDate: string,
  encodedCursor: string | null = null,
): Promise<CalendarDayPage> {
  if (!isValidCivilDate(selectedDate)) throw new Error("calendar_date_invalid");
  const cursor = decodeFeedCursor(encodedCursor);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("calendar_day_entries", {
      p_cursor_entry_id: cursor?.entryId ?? null,
      p_cursor_occurred_at: cursor?.occurredAt ?? null,
      p_limit: feedPageSize,
      p_local_date: selectedDate,
    });
  if (error) throw new Error("calendar_day_read_failed", { cause: error });

  const rawEntries = (data ?? []) as Omit<FeedEntry, "media" | "place">[];
  const revisionIds = rawEntries.map((entry) => entry.current_revision_id);
  const { data: mediaRows, error: mediaError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_media", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (mediaError)
    throw new Error("calendar_media_read_failed", { cause: mediaError });
  const media = (mediaRows ?? []) as (EntryMedia & { revision_id: string })[];
  const { data: placeRows, error: placeError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_places", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (placeError)
    throw new Error("calendar_place_read_failed", { cause: placeError });
  const places = (placeRows ?? []) as RevisionPlaceRow[];
  const { data: tagRows, error: tagError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_tags", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (tagError)
    throw new Error("calendar_tag_read_failed", { cause: tagError });
  const tags = (tagRows ?? []) as RevisionTagRow[];
  const entries = rawEntries.map((entry) => ({
    ...entry,
    media: media
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.media_position - b.media_position),
    place: normalizePlace(
      places.find(
        (item) =>
          item.revision_id === entry.current_revision_id && !item.redacted_at,
      ),
    ),
    tags: tags
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.tag_position - b.tag_position),
  }));
  const lastEntry = entries.at(-1);
  return {
    entries,
    nextCursor:
      entries.length === feedPageSize && lastEntry
        ? encodeFeedCursor({
            entryId: lastEntry.entry_id,
            occurredAt: lastEntry.occurred_at,
          })
        : null,
  };
}

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

  const rawEntries = (data ?? []) as Omit<FeedEntry, "media" | "place">[];
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
  const { data: placeRows, error: placeError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_places", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (placeError) {
    throw new Error("feed_place_read_failed", { cause: placeError });
  }
  const places = (placeRows ?? []) as RevisionPlaceRow[];
  const { data: tagRows, error: tagError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_tags", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (tagError) throw new Error("feed_tag_read_failed", { cause: tagError });
  const tags = (tagRows ?? []) as RevisionTagRow[];
  const entries: FeedEntry[] = rawEntries.map((entry) => ({
    ...entry,
    media: media
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.media_position - b.media_position),
    place: normalizePlace(
      places.find(
        (item) =>
          item.revision_id === entry.current_revision_id && !item.redacted_at,
      ),
    ),
    tags: tags
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.tag_position - b.tag_position),
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
  const { data: placeRows, error: placeError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_places", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (placeError) {
    throw new Error("entry_place_history_failed", { cause: placeError });
  }
  const places = (placeRows ?? []) as RevisionPlaceRow[];
  const { data: tagRows, error: tagError } = revisionIds.length
    ? await supabase
        .schema("app")
        .rpc("revision_tags", { p_revision_ids: revisionIds })
    : { data: [], error: null };
  if (tagError) {
    throw new Error("entry_tag_history_failed", { cause: tagError });
  }
  const tags = (tagRows ?? []) as RevisionTagRow[];

  return {
    ...(entry as Omit<EntryDetail, "revisions">),
    revisions: (revisions ?? []).map((revision) => ({
      ...revision,
      media: media
        .filter((item) => item.revision_id === revision.id)
        .sort((a, b) => a.media_position - b.media_position),
      place: normalizePlace(
        places.find((item) => item.revision_id === revision.id),
      ),
      tags: tags
        .filter((item) => item.revision_id === revision.id)
        .sort((a, b) => a.tag_position - b.tag_position),
    })),
  };
}

export async function getPrivateProfile(): Promise<PrivateProfile> {
  const supabase = await createSupabaseServerClient();
  const { data: profile, error } = await supabase
    .schema("app")
    .from("profiles")
    .select("display_name,handle,bio,created_at,updated_at")
    .single();
  if (error || !profile) {
    throw new Error("profile_read_failed", { cause: error });
  }
  const { data: media, error: mediaError } = await supabase
    .schema("app")
    .from("profile_media")
    .select("media_role,attachment_id");
  if (mediaError) {
    throw new Error("profile_media_read_failed", { cause: mediaError });
  }
  const avatar = media?.find((item) => item.media_role === "avatar");
  const banner = media?.find((item) => item.media_role === "banner");
  return {
    ...profile,
    avatar_attachment_id: avatar?.attachment_id ?? null,
    banner_attachment_id: banner?.attachment_id ?? null,
  } as PrivateProfile;
}

export async function getProfileStatistics(): Promise<ProfileStatistics> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("profile_statistics");
  const row = (data as Record<string, number | string>[] | null)?.[0];
  if (error || !row) {
    throw new Error("profile_statistics_read_failed", { cause: error });
  }
  return {
    active_entries: Number(row.active_entries),
    active_logging_days: Number(row.active_logging_days),
    current_month_entries: Number(row.current_month_entries),
    image_entries: Number(row.image_entries),
    voice_entries: Number(row.voice_entries),
    video_entries: Number(row.video_entries),
    place_entries: Number(row.place_entries),
    tagged_entries: Number(row.tagged_entries),
    edited_entries: Number(row.edited_entries),
  };
}

export async function getTagSuggestions(
  prefix = "",
  limit = 12,
): Promise<TagSuggestion[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("tag_suggestions", {
    p_prefix: prefix,
    p_limit: limit,
  });
  if (error) throw new Error("tag_suggestions_failed", { cause: error });
  return (data ?? []).map(
    (row: {
      tag_id: string;
      display_name: string;
      normalized_name: string;
      active_usage: number | string;
    }) => ({
      ...row,
      tag_position: 0,
      active_usage: Number(row.active_usage),
    }),
  );
}

export async function getTagCollections(): Promise<TagCollection[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("tag_collection_counts");
  if (error) throw new Error("tag_collections_failed", { cause: error });
  return (data ?? []).map(
    (row: {
      display_name: string;
      normalized_name: string;
      depth: number | string;
      direct_entry_count: number | string;
      collection_entry_count: number | string;
      is_explicit: boolean;
      has_children: boolean;
    }) => ({
      ...row,
      depth: Number(row.depth),
      direct_entry_count: Number(row.direct_entry_count),
      collection_entry_count: Number(row.collection_entry_count),
    }),
  );
}

export async function getSearchPage(
  parameters: SearchParameters,
): Promise<SearchPage> {
  const scope = searchScope(parameters);
  const cursor = decodeSearchCursor(parameters.cursor, scope);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("search_entries", {
    p_cursor_entry_id: cursor?.entryId ?? null,
    p_cursor_occurred_at: cursor?.occurredAt ?? null,
    p_cursor_rank: cursor?.rank ?? null,
    p_from: parameters.from,
    p_has_place: parameters.hasPlace,
    p_include_trash: parameters.includeTrash,
    p_include_tag_descendants: parameters.tagScope === "collection",
    p_limit: 20,
    p_media: parameters.media,
    p_query: parameters.query,
    p_sort: parameters.sort,
    p_tag_names: parameters.tags,
    p_to: parameters.to,
  });
  if (error) throw new Error("search_read_failed", { cause: error });
  const rawEntries = (data ?? []) as Omit<
    FeedEntry,
    "media" | "place" | "tags"
  >[];
  const revisionIds = rawEntries.map((entry) => entry.current_revision_id);
  const [mediaResult, placeResult, tagResult] = revisionIds.length
    ? await Promise.all([
        supabase
          .schema("app")
          .rpc("revision_media", { p_revision_ids: revisionIds }),
        supabase
          .schema("app")
          .rpc("revision_places", { p_revision_ids: revisionIds }),
        supabase
          .schema("app")
          .rpc("revision_tags", { p_revision_ids: revisionIds }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (mediaResult.error || placeResult.error || tagResult.error) {
    throw new Error("search_hydration_failed", {
      cause: mediaResult.error ?? placeResult.error ?? tagResult.error,
    });
  }
  const media = (mediaResult.data ?? []) as (EntryMedia & {
    revision_id: string;
  })[];
  const places = (placeResult.data ?? []) as RevisionPlaceRow[];
  const tags = (tagResult.data ?? []) as RevisionTagRow[];
  const entries: FeedEntry[] = rawEntries.map((entry) => ({
    ...entry,
    result_rank: Number(entry.result_rank ?? 0),
    media: media
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.media_position - b.media_position),
    place: normalizePlace(
      places.find(
        (item) =>
          item.revision_id === entry.current_revision_id && !item.redacted_at,
      ),
    ),
    tags: tags
      .filter((item) => item.revision_id === entry.current_revision_id)
      .sort((a, b) => a.tag_position - b.tag_position),
  }));
  const last = entries.at(-1);
  return {
    entries,
    nextCursor:
      entries.length === 20 && last
        ? encodeSearchCursor({
            scope,
            rank:
              parameters.sort === "relevance"
                ? Number(last.result_rank ?? 0)
                : null,
            occurredAt: last.occurred_at,
            entryId: last.entry_id,
          })
        : null,
  };
}
