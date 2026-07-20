import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthorizedImageUpload = {
  entry_id: string;
  attachment_id: string;
  object_id: string;
  bucket_id: string;
  object_key: string;
};

export async function authorizeImageUpload(
  supabase: SupabaseClient,
  input: {
    entryId: string | null;
    filename: string;
    declaredMime: string;
    byteCount: number;
  },
): Promise<AuthorizedImageUpload> {
  const { data, error } = await supabase
    .schema("app")
    .rpc("authorize_image_upload", {
      p_entry_id: input.entryId,
      p_original_filename: input.filename,
      p_declared_mime: input.declaredMime,
      p_expected_byte_count: input.byteCount,
    });
  if (error) throw error;
  const row = (data as AuthorizedImageUpload[] | null)?.[0];
  if (!row) throw new Error("odiina_upload_authorization_missing");
  return row;
}

export async function finalizeImageUpload(
  supabase: SupabaseClient,
  attachmentId: string,
) {
  const { data, error } = await supabase
    .schema("app")
    .rpc("finalize_image_upload", { p_attachment_id: attachmentId });
  if (error) throw error;
  return (data as { job_id: string; attachment_state: string }[] | null)?.[0];
}
