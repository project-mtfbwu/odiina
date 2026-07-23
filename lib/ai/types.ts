export type AiSettings = {
  master_enabled: boolean;
  transcription_enabled: boolean;
  insights_enabled: boolean;
  transcript_search_enabled: boolean;
  auto_transcribe_enabled: boolean;
  consent_version: number;
  consent_policy_version: string;
  provider_policy_version: string | null;
  updated_at: string;
};

export type AiUsage = {
  transcription_minutes_month: number;
  insight_requests_today: number;
  insight_requests_month: number;
  active_jobs: number;
};

export type TranscriptSegment = {
  id: string;
  position: number;
  start_ms: number;
  end_ms: number;
  machine_text: string;
  corrected_text: string | null;
  corrected_at: string | null;
};

export type Transcript = {
  id: string;
  job_id: string;
  entry_id: string;
  revision_id: string;
  attachment_id: string;
  source_kind: "audio" | "video_audio";
  language: string | null;
  language_hint: string | null;
  language_confidence: number | null;
  timing_kind: "segment" | "utterance" | null;
  provider_id: string;
  model_id: string;
  status: "ready" | "stale" | "deleted";
  current: boolean;
  search_enabled: boolean;
  completed_at: string;
  segments: TranscriptSegment[];
};

export type AiJob = {
  id: string;
  job_kind: "transcription" | "insight";
  status:
    | "queued"
    | "sending"
    | "transcribing"
    | "processing_response"
    | "generating"
    | "ready"
    | "failed"
    | "canceled"
    | "dead_letter";
  safe_error_code: string | null;
  cancel_requested: boolean;
  attempts: number;
  updated_at: string;
};

export type EntryTranscriptState = {
  transcript: Transcript | null;
  job: AiJob | null;
};

export type InsightListItem = {
  id: string;
  scope: "entry" | "day" | "range" | "week" | "month";
  range_start: string;
  range_end: string;
  title: string;
  summary: string;
  status: "ready" | "stale";
  created_at: string;
};

export type InsightSource = {
  id: string;
  entry_id: string;
  revision_id: string;
  occurred_local_date: string;
  evidence_excerpt: string;
  source_unavailable: boolean;
  start_ms: number | null;
  end_ms: number | null;
};

export type InsightDetail = InsightListItem & {
  key_moments: string[];
  topics: string[];
  open_loops: string[];
  limitations: string;
  provider_id: string;
  model_id: string;
  sources: InsightSource[];
};
