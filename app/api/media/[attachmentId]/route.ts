import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

const privateMediaHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  vary: "Cookie",
};

function requestedRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid" as const;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid" as const;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid" as const;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function deliver(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
  head = false,
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
    .select("id,state,media_kind,purpose,entries!inner(lifecycle_state)")
    .eq("id", attachmentId)
    .eq("state", "accepted")
    .single();
  const entry = attachment?.entries as unknown as
    { lifecycle_state: string } | undefined;
  if (
    error ||
    !attachment ||
    !entry ||
    attachment.purpose !== "entry" ||
    !["image", "audio"].includes(attachment.media_kind) ||
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
    .eq("variant", attachment.media_kind === "audio" ? "playback" : "display")
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
  const size = blob.size;
  const contentType =
    attachment.media_kind === "audio" ? "audio/mp4" : "image/jpeg";
  const range =
    attachment.media_kind === "audio"
      ? requestedRange(request.headers.get("range"), size)
      : null;
  if (range === "invalid") {
    return context.applyAuthState(
      new NextResponse(null, {
        status: 416,
        headers: {
          ...privateMediaHeaders,
          "accept-ranges": "bytes",
          "content-range": `bytes */${size}`,
        },
      }),
    );
  }
  const selected = range ? blob.slice(range.start, range.end + 1) : blob;
  return context.applyAuthState(
    new NextResponse(head ? null : selected.stream(), {
      status: range ? 206 : 200,
      headers: {
        ...privateMediaHeaders,
        "content-type": contentType,
        "content-length": String(selected.size),
        "content-disposition": "inline",
        ...(attachment.media_kind === "audio"
          ? {
              "accept-ranges": "bytes",
              ...(range
                ? {
                    "content-range": `bytes ${range.start}-${range.end}/${size}`,
                  }
                : {}),
            }
          : {}),
      },
    }),
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return deliver(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return deliver(request, context, true);
}
