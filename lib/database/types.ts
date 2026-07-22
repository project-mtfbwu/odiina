export type EntryImageMedia = {
  attachment_id: string;
  media_position: number;
  media_kind: "image";
  width: number;
  height: number;
  duration_ms: null;
  waveform_peaks: null;
};

export type EntryAudioMedia = {
  attachment_id: string;
  media_position: number;
  media_kind: "audio";
  width: null;
  height: null;
  duration_ms: number;
  waveform_peaks: number[];
};

export type EntryVideoMedia = {
  attachment_id: string;
  media_position: number;
  media_kind: "video";
  width: number;
  height: number;
  duration_ms: number;
  waveform_peaks: null;
  has_audio: boolean;
  poster_width: number;
  poster_height: number;
};

export type EntryMedia = EntryImageMedia | EntryAudioMedia | EntryVideoMedia;

export type EntryTag = {
  tag_id: string;
  display_name: string;
  normalized_name: string;
  tag_position: number;
};

export type EntryPlace = {
  place_name: string | null;
  place_area: string | null;
  place_address: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: "label_only" | "approximate" | "exact" | null;
  approximate_radius_meters: number | null;
  source: "manual" | "device" | "search" | "nearby" | null;
  provider: string | null;
  provider_place_id: string | null;
  country_code: string | null;
  created_at: string;
  redacted_at: string | null;
};

export type FeedEntry = {
  entry_id: string;
  current_revision_id: string;
  body_text: string;
  revision_number: number;
  occurred_at: string;
  occurred_timezone: string;
  occurred_local_date: string;
  created_at: string;
  updated_at: string;
  media: EntryMedia[];
  place: EntryPlace | null;
  tags: EntryTag[];
  lifecycle_state?: "active" | "trashed";
  trashed_at?: string | null;
  result_rank?: number;
};

export type EntryRevision = {
  id: string;
  revision_number: number;
  body_text: string;
  occurred_at: string;
  occurred_timezone: string;
  occurred_local_date: string;
  occurred_utc_offset_minutes: number;
  change_reason: string;
  created_at: string;
  media: EntryMedia[];
  place: EntryPlace | null;
  tags: EntryTag[];
};

export type EntryDetail = {
  id: string;
  current_revision_id: string;
  lifecycle_state: "active" | "trashed";
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  purge_after: string | null;
  revisions: EntryRevision[];
};

export type UserPreferences = {
  locale: string;
  iana_timezone: string | null;
  week_starts_on: number;
};

export type CalendarActivity = {
  occurred_local_date: string;
  entry_count: number;
};

export type PrivateProfile = {
  display_name: string;
  handle: string;
  bio: string;
  created_at: string;
  updated_at: string;
  avatar_attachment_id: string | null;
  banner_attachment_id: string | null;
};

export type ProfileStatistics = {
  active_entries: number;
  active_logging_days: number;
  current_month_entries: number;
  image_entries: number;
  voice_entries: number;
  video_entries: number;
  place_entries: number;
  tagged_entries: number;
  edited_entries: number;
};
