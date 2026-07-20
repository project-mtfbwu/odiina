import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  ODIINA_STORAGE_TUS_URL: z.string().url().optional(),
  ODIINA_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function hasSupabaseEnvironment(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getApplicationUrl(): URL {
  return new URL(process.env.ODIINA_APP_URL ?? "http://localhost:3000");
}

export function getServerEnvironment(): ServerEnvironment {
  return serverEnvironmentSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    ODIINA_STORAGE_TUS_URL: process.env.ODIINA_STORAGE_TUS_URL,
    ODIINA_APP_URL: process.env.ODIINA_APP_URL,
  });
}

export function getStorageTusEndpoint(environment = getServerEnvironment()) {
  if (environment.ODIINA_STORAGE_TUS_URL) {
    return new URL(environment.ODIINA_STORAGE_TUS_URL);
  }
  const endpoint = new URL(environment.SUPABASE_URL);
  endpoint.pathname = "/storage/v1/upload/resumable/sign";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}
