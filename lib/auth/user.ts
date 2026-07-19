import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/server-client";
import { hasSupabaseEnvironment } from "@/lib/environment";

export type VerifiedUser = {
  id: string;
  email: string | null;
};

export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  if (!hasSupabaseEnvironment()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims.sub) {
    return null;
  }

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
}

export async function requireVerifiedUser(): Promise<VerifiedUser> {
  const user = await getVerifiedUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
