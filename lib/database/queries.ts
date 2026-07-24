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
import type {
  AiJob,
  AiSettings,
  AiUsage,
  EntryTranscriptState,
  InsightDetail,
  InsightListItem,
  Transcript,
  TranscriptSegment,
} from "@/lib/ai/types";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  searchScope,
  type SearchParameters,
} from "@/lib/search/parameters";
import type {
  ReportDetail,
  ReportCitation,
  ReportListItem,
  ReportMedia,
  ReportMetric,
  ReportTag,
  ReportSection,
  ReportShare,
  ReportSource,
} from "@/lib/reports/types";

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
  const transcriptMatches =
    parameters.query.trim().length >= 2 && rawEntries.length
      ? await supabase.schema("app").rpc("transcript_match_entries", {
          p_entry_ids: rawEntries.map((entry) => entry.entry_id),
          p_query: parameters.query,
        })
      : { data: [], error: null };
  if (transcriptMatches.error) {
    throw new Error("transcript_match_read_failed", {
      cause: transcriptMatches.error,
    });
  }
  const transcriptEntryIds = new Set(
    (transcriptMatches.data ?? []).map(
      (row: { entry_id: string }) => row.entry_id,
    ),
  );
  const entries: FeedEntry[] = rawEntries.map((entry) => ({
    ...entry,
    result_rank: Number(entry.result_rank ?? 0),
    match_source: transcriptEntryIds.has(entry.entry_id)
      ? "Transcript"
      : undefined,
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

export async function getAiSettings(): Promise<AiSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .from("ai_settings")
    .select(
      "master_enabled,transcription_enabled,insights_enabled,transcript_search_enabled,auto_transcribe_enabled,consent_version,consent_policy_version,provider_policy_version,updated_at",
    )
    .single();
  if (error || !data)
    throw new Error("ai_settings_read_failed", { cause: error });
  return data as AiSettings;
}

export async function getAiUsage(): Promise<AiUsage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("ai_usage_summary");
  const row = (data as Record<string, string | number>[] | null)?.[0];
  if (error || !row) throw new Error("ai_usage_read_failed", { cause: error });
  return {
    transcription_minutes_month: Number(row.transcription_minutes_month),
    insight_requests_today: Number(row.insight_requests_today),
    insight_requests_month: Number(row.insight_requests_month),
    active_jobs: Number(row.active_jobs),
  };
}

export async function getEntryTranscriptState(
  entryId: string,
  revisionId: string,
): Promise<EntryTranscriptState> {
  const supabase = await createSupabaseServerClient();
  const [
    { data: jobData, error: jobError },
    { data: transcriptData, error: transcriptError },
  ] = await Promise.all([
    supabase
      .schema("app")
      .from("ai_jobs")
      .select(
        "id,job_kind,status,safe_error_code,cancel_requested,attempts,updated_at",
      )
      .eq("job_kind", "transcription")
      .eq("entry_id", entryId)
      .eq("revision_id", revisionId)
      .order("queued_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .schema("app")
      .from("transcripts")
      .select(
        "id,job_id,entry_id,revision_id,attachment_id,source_kind,language,language_hint,language_confidence,timing_kind,provider_id,model_id,status,current,search_enabled,completed_at",
      )
      .eq("entry_id", entryId)
      .eq("revision_id", revisionId)
      .eq("current", true)
      .maybeSingle(),
  ]);
  if (jobError || transcriptError) {
    throw new Error("transcript_state_read_failed", {
      cause: jobError ?? transcriptError,
    });
  }
  let transcript: Transcript | null = null;
  if (transcriptData) {
    const [
      { data: segments, error: segmentError },
      { data: corrections, error: correctionError },
    ] = await Promise.all([
      supabase
        .schema("app")
        .from("transcript_segments")
        .select("id,position,start_ms,end_ms,machine_text")
        .eq("transcript_id", transcriptData.id)
        .order("position"),
      supabase
        .schema("app")
        .from("transcript_corrections")
        .select("segment_id,corrected_text,created_at,id")
        .eq("transcript_id", transcriptData.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ]);
    if (segmentError || correctionError) {
      throw new Error("transcript_segments_read_failed", {
        cause: segmentError ?? correctionError,
      });
    }
    const latest = new Map<
      string,
      { corrected_text: string; created_at: string }
    >();
    for (const correction of corrections ?? []) {
      if (!latest.has(correction.segment_id))
        latest.set(correction.segment_id, correction);
    }
    transcript = {
      ...(transcriptData as Omit<Transcript, "segments">),
      language_confidence:
        transcriptData.language_confidence === null
          ? null
          : Number(transcriptData.language_confidence),
      segments: (segments ?? []).map((segment) => {
        const correction = latest.get(segment.id);
        return {
          ...segment,
          corrected_text: correction?.corrected_text ?? null,
          corrected_at: correction?.created_at ?? null,
        } as TranscriptSegment;
      }),
    };
  }
  return {
    transcript,
    job: (jobData as AiJob | null) ?? null,
  };
}

export async function getInsights(): Promise<InsightListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .from("insights")
    .select("id,scope,range_start,range_end,title,summary,status,created_at")
    .in("status", ["ready", "stale"])
    .order("created_at", { ascending: false });
  if (error) throw new Error("insights_read_failed", { cause: error });
  return (data ?? []) as InsightListItem[];
}

export async function getInsightDetail(
  insightId: string,
): Promise<InsightDetail> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .from("insights")
    .select(
      "id,scope,range_start,range_end,title,summary,key_moments,topics,open_loops,limitations,provider_id,model_id,status,created_at",
    )
    .eq("id", insightId)
    .in("status", ["ready", "stale"])
    .maybeSingle();
  if (error) throw new Error("insight_read_failed", { cause: error });
  if (!data) notFound();
  const { data: sources, error: sourceError } = await supabase
    .schema("app")
    .from("insight_sources")
    .select(
      "id,entry_id,revision_id,occurred_local_date,evidence_excerpt,source_unavailable,start_ms,end_ms",
    )
    .eq("insight_id", insightId)
    .order("source_position");
  if (sourceError)
    throw new Error("insight_sources_read_failed", { cause: sourceError });
  return { ...data, sources: sources ?? [] } as InsightDetail;
}

export async function getReports(filter?: {
  type?: "daily" | "weekly" | "monthly" | "yearly" | "custom";
  state?: "draft" | "ready" | "stale" | "shared";
}): Promise<ReportListItem[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .schema("app")
    .from("reports")
    .select(
      "id,report_type,period_start,period_end,title,generation_mode,status,created_at,generated_at",
    )
    .neq("status", "deleted");
  if (filter?.type) query = query.eq("report_type", filter.type);
  if (filter?.state && filter.state !== "shared")
    query = query.eq("status", filter.state);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("reports_read_failed", { cause: error });
  const reportIds = (data ?? []).map((report) => report.id);
  if (!reportIds.length) return [];
  const [shareResult, exportResult] = await Promise.all([
    supabase
      .schema("app")
      .from("report_shares")
      .select("report_id")
      .in("report_id", reportIds)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()),
    supabase
      .schema("app")
      .from("report_exports")
      .select("report_id")
      .in("report_id", reportIds)
      .eq("status", "ready"),
  ]);
  const relationshipError = shareResult.error ?? exportResult.error;
  if (relationshipError)
    throw new Error("reports_state_read_failed", { cause: relationshipError });
  const countByReport = (rows: { report_id: string }[]) => {
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(row.report_id, (counts.get(row.report_id) ?? 0) + 1);
    return counts;
  };
  const shares = countByReport(shareResult.data ?? []);
  const exports = countByReport(exportResult.data ?? []);
  const reports = (data ?? []).map((report) => ({
    ...report,
    active_share_count: shares.get(report.id) ?? 0,
    export_count: exports.get(report.id) ?? 0,
  })) as ReportListItem[];
  return filter?.state === "shared"
    ? reports.filter((report) => report.active_share_count > 0)
    : reports;
}

export async function getReportDetail(reportId: string): Promise<ReportDetail> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .from("reports")
    .select(
      "id,report_type,period_start,period_end,period_timezone,week_starts_on,title,introduction,closing_reflection,generation_mode,insight_id,status,created_at,generated_at",
    )
    .eq("id", reportId)
    .neq("status", "deleted")
    .maybeSingle();
  if (error) throw new Error("report_read_failed", { cause: error });
  if (!data) notFound();
  const [
    sectionResult,
    metricResult,
    tagResult,
    sourceResult,
    mediaResult,
    shareResult,
    citationResult,
  ] = await Promise.all([
    supabase
      .schema("app")
      .from("report_sections")
      .select("id,section_kind,position,visible,heading,origin,generated_text")
      .eq("report_id", reportId)
      .order("position"),
    supabase
      .schema("app")
      .from("report_metrics")
      .select("metric_key,metric_value")
      .eq("report_id", reportId)
      .order("metric_key"),
    supabase
      .schema("app")
      .from("report_tags")
      .select("normalized_name,display_name,entry_count")
      .eq("report_id", reportId)
      .order("entry_count", { ascending: false })
      .order("normalized_name"),
    supabase
      .schema("app")
      .from("report_sources")
      .select(
        "source_position,entry_id,revision_id,occurred_at,occurred_local_date,body_excerpt,place_label,edited,selected,source_unavailable",
      )
      .eq("report_id", reportId)
      .order("source_position"),
    supabase
      .schema("app")
      .from("report_media_selections")
      .select(
        "id,entry_id,revision_id,attachment_id,media_kind,presentation_role,position,selected",
      )
      .eq("report_id", reportId)
      .order("position"),
    supabase
      .schema("app")
      .from("report_shares")
      .select(
        "id,token_prefix,expires_at,created_at,revoked_at,manifest_version,include_places",
      )
      .eq("report_id", reportId)
      .order("created_at", { ascending: false }),
    data.insight_id
      ? supabase
          .schema("app")
          .from("insight_sources")
          .select(
            "id,entry_id,revision_id,occurred_local_date,evidence_excerpt,start_ms,end_ms",
          )
          .eq("insight_id", data.insight_id)
          .order("source_position")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = [
    sectionResult.error,
    metricResult.error,
    tagResult.error,
    sourceResult.error,
    mediaResult.error,
    shareResult.error,
    citationResult.error,
  ].find(Boolean);
  if (firstError)
    throw new Error("report_relationships_read_failed", { cause: firstError });
  return {
    ...data,
    sections: (sectionResult.data ?? []) as ReportSection[],
    metrics: (metricResult.data ?? []).map((metric) => ({
      ...metric,
      metric_value: Number(metric.metric_value),
    })) as ReportMetric[],
    tags: (tagResult.data ?? []).map((tag) => ({
      ...tag,
      entry_count: Number(tag.entry_count),
    })) as ReportTag[],
    sources: (sourceResult.data ?? []) as ReportSource[],
    media: (mediaResult.data ?? []) as ReportMedia[],
    shares: (shareResult.data ?? []) as ReportShare[],
    citations: (citationResult.data ?? []) as ReportCitation[],
  } as ReportDetail;
}
