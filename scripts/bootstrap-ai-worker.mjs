import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "ODIINA_AI_BOOTSTRAP_SERVICE_ROLE_KEY",
  "ODIINA_AI_WORKER_EMAIL",
  "ODIINA_AI_WORKER_PASSWORD",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const url = new URL(process.env.SUPABASE_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
  throw new Error("AI worker bootstrap is local-only until deployment review");
}
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.ODIINA_AI_BOOTSTRAP_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = process.env.ODIINA_AI_WORKER_EMAIL;
const password = process.env.ODIINA_AI_WORKER_PASSWORD;
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) throw users.error;
let worker = users.data.users.find((user) => user.email === email);
const generation = Number(worker?.app_metadata?.ai_worker_generation ?? 0) + 1;
const metadata = { odiina_ai_worker: true, ai_worker_generation: generation };
if (worker) {
  const updated = await admin.auth.admin.updateUserById(worker.id, {
    password,
    email_confirm: true,
    app_metadata: metadata,
  });
  if (updated.error) throw updated.error;
  worker = updated.data.user;
} else {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: metadata,
  });
  if (created.error) throw created.error;
  worker = created.data.user;
}
const registration = await admin.schema("app").rpc("register_ai_worker", {
  p_auth_user_id: worker.id,
  p_generation: generation,
});
if (registration.error) throw registration.error;
console.info("AI worker registered", { generation });
