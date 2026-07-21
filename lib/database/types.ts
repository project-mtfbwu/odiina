export type EntryMedia = {
  attachment_id: string;
  media_position: number;
  width: number;
  height: number;
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
