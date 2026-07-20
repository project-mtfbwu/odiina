import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateEntryInput,
  ReviseEntryInput,
} from "@/lib/validation/entry";

type MutationResult = {
  entry_id: string;
  revision_id: string;
};

export async function createEntry(
  supabase: SupabaseClient,
  input: CreateEntryInput,
): Promise<MutationResult> {
  const { data, error } = await supabase.schema("app").rpc("create_entry", {
    p_body_text: input.bodyText,
    p_client_request_id: input.clientRequestId,
    p_occurred_at: input.occurredAt,
    p_occurred_local_date: input.occurredLocalDate,
    p_occurred_timezone: input.occurredTimezone,
    p_occurred_utc_offset_minutes: input.occurredUtcOffsetMinutes,
  });

  if (error) {
    throw error;
  }
  const row = (data as MutationResult[] | null)?.[0];
  if (!row) {
    throw new Error("entry_create_no_result");
  }
  return row;
}

export async function reviseEntry(
  supabase: SupabaseClient,
  entryId: string,
  input: ReviseEntryInput,
): Promise<MutationResult> {
  const parameters = {
    p_body_text: input.bodyText,
    p_change_reason: input.changeReason,
    p_entry_id: entryId,
    p_expected_current_revision_id: input.expectedCurrentRevisionId,
    p_occurred_at: input.occurredAt,
    p_occurred_local_date: input.occurredLocalDate,
    p_occurred_timezone: input.occurredTimezone,
    p_occurred_utc_offset_minutes: input.occurredUtcOffsetMinutes,
  };
  const { data, error } =
    input.attachmentIds === undefined
      ? await supabase.schema("app").rpc("revise_entry", parameters)
      : await supabase.schema("app").rpc("revise_entry_media", {
          ...parameters,
          p_attachment_ids: input.attachmentIds,
        });

  if (error) {
    throw error;
  }
  const row = (data as MutationResult[] | null)?.[0];
  if (!row) {
    throw new Error("entry_revise_no_result");
  }
  return row;
}
