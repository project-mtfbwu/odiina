import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/server-client";
import { hasSupabaseEnvironment } from "@/lib/environment";

export type VerifiedUser = {
  id: string;
  email: string | null;
  displayName: string;
};

function fallbackDisplayName(email: string | null): string {
  const localPart = email
    ?.split("@")[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  if (!localPart) return "Odiina member";
  return localPart.replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  if (!hasSupabaseEnvironment()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims.sub) {
    return null;
  }

  const email =
    typeof data.claims.email === "string" ? data.claims.email : null;
  const metadata =
    typeof data.claims.user_metadata === "object" &&
    data.claims.user_metadata !== null
      ? (data.claims.user_metadata as Record<string, unknown>)
      : null;
  const metadataName =
    typeof metadata?.display_name === "string"
      ? metadata.display_name.trim()
      : "";

  return {
    id: data.claims.sub,
    email,
    displayName: metadataName || fallbackDisplayName(email),
  };
}

export async function requireVerifiedUser(): Promise<VerifiedUser> {
  const user = await getVerifiedUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
