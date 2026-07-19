import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { forceHttpOnly } from "@/lib/auth/cookie-options";
import { getServerEnvironment } from "@/lib/environment";

export async function createSupabaseServerClient() {
  const environment = getServerEnvironment();
  const cookieStore = await cookies();

  return createServerClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        encode: "tokens-only",
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, forceHttpOnly(options));
            }
          } catch {
            // Server Components cannot set cookies. proxy.ts refreshes them
            // before protected rendering; Route Handlers use route-client.ts.
          }
        },
      },
    },
  );
}
