import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

const privateImageHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const { attachmentId } = await params;
  const trash = request.nextUrl.searchParams.get("scope") === "trash";
  const { data: attachment, error } = await context.supabase
    .schema("app")
    .from("attachments")
    .select("id,state,entries!inner(lifecycle_state)")
    .eq("id", attachmentId)
    .eq("state", "accepted")
    .single();
  const entry = attachment?.entries as unknown as
    { lifecycle_state: string } | undefined;
  if (
    error ||
    !attachment ||
    !entry ||
    (trash
      ? entry.lifecycle_state !== "trashed"
      : entry.lifecycle_state !== "active")
  ) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_found" }, { status: 404 }),
    );
  }
  const { data: object, error: objectError } = await context.supabase
    .schema("app")
    .from("attachment_objects")
    .select("bucket_id,object_key")
    .eq("attachment_id", attachmentId)
    .eq("variant", "display")
    .eq("state", "verified")
    .single();
  if (objectError || !object) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_ready" }, { status: 404 }),
    );
  }
  const { data: blob, error: downloadError } = await context.supabase.storage
    .from(object.bucket_id)
    .download(object.object_key);
  if (downloadError || !blob) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_unavailable" }, { status: 404 }),
    );
  }
  return context.applyAuthState(
    new NextResponse(blob.stream(), {
      headers: {
        ...privateImageHeaders,
        "content-type": "image/jpeg",
      },
    }),
  );
}
