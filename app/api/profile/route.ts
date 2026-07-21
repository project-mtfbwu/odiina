import { NextResponse, type NextRequest } from "next/server";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";
import { safeErrorMessage } from "@/lib/security/safe-errors";
import { saveProfileSchema } from "@/lib/validation/profile";

export async function PUT(request: NextRequest) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json({ error: "authentication_required" }, { status: 401 }),
    );
  }
  try {
    assertCsrf(request, request.headers.get("x-odiina-csrf") ?? "");
    const parsed = saveProfileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return context.applyAuthState(
        NextResponse.json(
          {
            error: "profile_invalid",
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
          { status: 400, headers: { "cache-control": "private, no-store" } },
        ),
      );
    }
    const { data, error } = await context.supabase
      .schema("app")
      .rpc("save_profile", {
        p_display_name: parsed.data.displayName,
        p_handle: parsed.data.handle,
        p_bio: parsed.data.bio,
        p_avatar_attachment_id: parsed.data.avatarAttachmentId,
        p_banner_attachment_id: parsed.data.bannerAttachmentId,
      });
    if (error) throw error;
    return context.applyAuthState(
      NextResponse.json(
        { profile: data?.[0] },
        { headers: { "cache-control": "private, no-store" } },
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "profile_save_failed";
    const csrf = code.includes("csrf");
    const conflict = code.includes("odiina_handle_unavailable");
    return context.applyAuthState(
      NextResponse.json(
        {
          error: conflict ? "handle_unavailable" : "profile_save_failed",
          message: csrf
            ? "The request could not be verified."
            : safeErrorMessage(code),
        },
        {
          status: csrf ? 403 : conflict ? 409 : 400,
          headers: { "cache-control": "private, no-store" },
        },
      ),
    );
  }
}
