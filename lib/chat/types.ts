export type ChatMode = "saved" | "temporary";

export type ChatRetrievalPlan = {
  query: string;
  tags: string[];
  media: Array<"text" | "image" | "audio" | "video" | "place">;
  place: string;
  from: string | null;
  to: string | null;
  sort: "newest" | "oldest";
  includeTranscripts: boolean;
  resolvedLabel: string;
};

export type ChatConversationListItem = {
  id: string;
  mode: ChatMode;
  title: string;
  last_activity_at: string;
  created_at: string;
};

export type ChatCitation = {
  id: string;
  citation_key: string;
  source_kind: "entry" | "transcript" | "report" | "insight";
  entry_id: string | null;
  transcript_id: string | null;
  transcript_segment_id: string | null;
  report_id: string | null;
  insight_id: string | null;
  occurred_local_date: string | null;
  start_ms: number | null;
  end_ms: number | null;
  evidence_excerpt: string;
  source_unavailable: boolean;
  source_stale: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status:
    | "queued"
    | "retrieving"
    | "generating"
    | "validating"
    | "ready"
    | "failed"
    | "canceled"
    | "stale";
  safe_error_code: string | null;
  unsupported_claims_removed: boolean;
  created_at: string;
  citations: ChatCitation[];
};

export type ChatConversationDetail = ChatConversationListItem & {
  context_state: ChatRetrievalPlan | Record<string, never>;
  expires_at: string | null;
  messages: ChatMessage[];
};

export type ChatUsage = {
  questions_today: number;
  questions_month: number;
  active_chat_jobs: number;
};
