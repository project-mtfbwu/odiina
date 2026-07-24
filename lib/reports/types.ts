export type ReportListItem = {
  id: string;
  report_type: "daily" | "weekly" | "monthly" | "yearly" | "custom";
  period_start: string;
  period_end: string;
  title: string;
  generation_mode: "factual" | "ai_enhanced";
  status: "draft" | "ready" | "stale";
  created_at: string;
  generated_at: string;
  active_share_count: number;
  export_count: number;
};

export type ReportSection = {
  id: string;
  section_kind: string;
  position: number;
  visible: boolean;
  heading: string;
  origin: "factual" | "user" | "ai";
  generated_text: string;
};

export type ReportMetric = { metric_key: string; metric_value: number };

export type ReportTag = {
  normalized_name: string;
  display_name: string;
  entry_count: number;
};

export type ReportSource = {
  source_position: number;
  entry_id: string;
  revision_id: string;
  occurred_at: string;
  occurred_local_date: string;
  body_excerpt: string;
  place_label: string | null;
  edited: boolean;
  selected: boolean;
  source_unavailable: boolean;
};

export type ReportMedia = {
  id: string;
  entry_id: string;
  revision_id: string;
  attachment_id: string;
  media_kind: "image" | "audio" | "video";
  presentation_role: "gallery" | "cover";
  position: number;
  selected: boolean;
};

export type ReportShare = {
  id: string;
  token_prefix: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  manifest_version: number;
  include_places: boolean;
};

export type ReportCitation = {
  id: string;
  entry_id: string;
  revision_id: string;
  occurred_local_date: string;
  evidence_excerpt: string;
  start_ms: number | null;
  end_ms: number | null;
};

export type ReportDetail = ReportListItem & {
  period_timezone: string;
  week_starts_on: number;
  introduction: string;
  closing_reflection: string;
  insight_id: string | null;
  generated_at: string;
  sections: ReportSection[];
  metrics: ReportMetric[];
  tags: ReportTag[];
  sources: ReportSource[];
  media: ReportMedia[];
  shares: ReportShare[];
  citations: ReportCitation[];
};

export type PublicReportManifest = {
  state: "active";
  title: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  expiresAt: string;
  sections: { kind: string; heading: string; content: string }[];
};

export type PublicReportResolution =
  PublicReportManifest | { state: "expired" | "revoked" };
