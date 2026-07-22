import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { getServerEnvironment } from "@/lib/environment";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

const privateMediaHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
  vary: "Cookie",
};

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
    !["image", "audio", "video"].includes(attachment.media_kind) ||
    (trash
      ? entry.lifecycle_state !== "trashed"
      : entry.lifecycle_state !== "active")
  ) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_found" }, { status: 404 }),
    );
  }
  const requestedVariant = request.nextUrl.searchParams.get("variant");
  const variant =
    attachment.media_kind === "image"
      ? "display"
      : attachment.media_kind === "video" && requestedVariant === "poster"
        ? "poster"
        : "playback";
  if (requestedVariant && requestedVariant !== "poster") {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_found" }, { status: 404 }),
    );
  }
  const { data: object, error: objectError } = await context.supabase
    .schema("app")
    .from("attachment_objects")
    .select("bucket_id,object_key")
    .eq("attachment_id", attachmentId)
    .eq("variant", variant)
    .eq("state", "verified")
    .single();
  if (objectError || !object) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_not_ready" }, { status: 404 }),
    );
  }
  const { data: sessionData } = await context.supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  const environment = getServerEnvironment();
  const objectUrl = new URL(
    `/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${object.object_key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    environment.SUPABASE_URL,
  );
  const canRange = attachment.media_kind !== "image" && variant === "playback";
  const upstream = await fetch(objectUrl, {
    method: head ? "HEAD" : "GET",
    headers: {
      apikey: environment.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${accessToken}`,
      ...(canRange && request.headers.get("range")
        ? { range: request.headers.get("range") as string }
        : {}),
    },
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    return context.applyAuthState(
      NextResponse.json({ error: "media_unavailable" }, { status: 404 }),
    );
  }
  const contentType =
    variant === "poster" || attachment.media_kind === "image"
      ? "image/jpeg"
      : attachment.media_kind === "audio"
        ? "audio/mp4"
        : "video/mp4";
  return context.applyAuthState(
    new NextResponse(head ? null : upstream.body, {
      status: upstream.status,
      headers: {
        ...privateMediaHeaders,
        "content-type": contentType,
        "content-disposition": "inline",
        ...(upstream.headers.get("content-length")
          ? {
              "content-length": upstream.headers.get(
                "content-length",
              ) as string,
            }
          : {}),
        ...(canRange
          ? {
              "accept-ranges": "bytes",
              ...(upstream.headers.get("content-range")
                ? {
                    "content-range": upstream.headers.get(
                      "content-range",
                    ) as string,
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
