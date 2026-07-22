import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifiedRequestClient } from "@/lib/auth/request-user";
import { assertCsrf } from "@/lib/security/csrf";
import { configurationUnavailableResponse } from "@/lib/security/http-responses";

const requestSchema = z.object({ prefix: z.string().max(40) });
const privateHeaders = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  const unavailable = configurationUnavailableResponse();
  if (unavailable) return unavailable;
  const context = await verifiedRequestClient(request);
  if (!context.userId) {
    return context.applyAuthState(
      NextResponse.json(
        { error: "authentication_required" },
        { status: 401, headers: privateHeaders },
      ),
    );
  }
  try {
    assertCsrf(request, request.headers.get("x-odiina-csrf") ?? "");
    const { prefix } = requestSchema.parse(await request.json());
    const { data, error } = await context.supabase
      .schema("app")
      .rpc("tag_suggestions", { p_prefix: prefix, p_limit: 12 });
    if (error) throw error;
    return context.applyAuthState(
      NextResponse.json(
        {
          suggestions: (data ?? []).map(
            (row: {
              tag_id: string;
              display_name: string;
              normalized_name: string;
              active_usage: number | string;
            }) => ({
              tagId: row.tag_id,
              displayName: row.display_name,
              normalizedName: row.normalized_name,
              activeUsage: Number(row.active_usage),
            }),
          ),
        },
        { headers: privateHeaders },
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "tag_query_failed";
    return context.applyAuthState(
      NextResponse.json(
        {
          error: "tag_suggestions_failed",
          message: code.includes("csrf")
            ? "Refresh Odiina and try again."
            : "Tag suggestions are temporarily unavailable. You can still create a tag.",
        },
        { status: code.includes("csrf") ? 403 : 400, headers: privateHeaders },
      ),
    );
  }
}
