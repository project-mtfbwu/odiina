import "server-only";

import { NextResponse } from "next/server";

import { hasSupabaseEnvironment } from "@/lib/environment";

export function configurationUnavailableResponse(): NextResponse | null {
  if (hasSupabaseEnvironment()) {
    return null;
  }
  return NextResponse.json(
    {
      error: "local_configuration_unavailable",
      message: "Start local Supabase and configure .env.local.",
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
