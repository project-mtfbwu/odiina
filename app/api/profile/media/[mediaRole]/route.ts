import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { profileMediaRoleSchema } from "@/lib/validation/profile";

const privateImageHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  vary: "Cookie",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mediaRole: string }> },
) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const role = profileMediaRoleSchema.safeParse((await params).mediaRole);
  if (!role.success) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_found" }, { status: 404 }),
    );
  }
  const { data: pointer, error } = await context.supabase
    .schema("app")
    .from("profile_media")
    .select("attachment_id")
    .eq("media_role", role.data)
    .single();
  if (error || !pointer) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_found" }, { status: 404 }),
    );
  }
  const { data: attachment, error: attachmentError } = await context.supabase
    .schema("app")
    .from("attachments")
    .select("id,state,purpose")
    .eq("id", pointer.attachment_id)
    .eq("state", "accepted")
    .eq("purpose", `profile_${role.data}`)
    .single();
  if (attachmentError || !attachment) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_ready" }, { status: 404 }),
    );
  }
  const { data: object, error: objectError } = await context.supabase
    .schema("app")
    .from("attachment_objects")
    .select("bucket_id,object_key")
    .eq("attachment_id", pointer.attachment_id)
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
      headers: { ...privateImageHeaders, "content-type": "image/jpeg" },
    }),
  );
}
