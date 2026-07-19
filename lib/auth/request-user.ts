import "server-only";

import type { NextRequest } from "next/server";

import { createSupabaseRouteClient } from "@/lib/auth/route-client";

export async function verifiedRequestClient(request: NextRequest) {
  const context = createSupabaseRouteClient(request);
  const { data, error } = await context.supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (error || !userId) {
    return { ...context, userId: null };
  }

  return { ...context, userId };
}
