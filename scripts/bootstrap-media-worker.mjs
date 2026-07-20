import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const required = [
  "SUPABASE_URL",
  "ODIINA_MEDIA_BOOTSTRAP_SERVICE_ROLE_KEY",
  "ODIINA_MEDIA_WORKER_EMAIL",
  "ODIINA_MEDIA_WORKER_PASSWORD",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
if (
  !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(
    process.env.SUPABASE_URL,
  )
) {
  throw new Error("Bootstrap is local-only unless explicitly reviewed");
}
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.ODIINA_MEDIA_BOOTSTRAP_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = process.env.ODIINA_MEDIA_WORKER_EMAIL;
const password = process.env.ODIINA_MEDIA_WORKER_PASSWORD;
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) throw users.error;
let worker = users.data.users.find((user) => user.email === email);
const generation = Number(worker?.app_metadata?.worker_generation ?? 0) + 1;
if (worker) {
  const updated = await admin.auth.admin.updateUserById(worker.id, {
    password,
    email_confirm: true,
    app_metadata: { odiina_worker: true, worker_generation: generation },
  });
  if (updated.error) throw updated.error;
  worker = updated.data.user;
} else {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { odiina_worker: true, worker_generation: generation },
  });
  if (created.error) throw created.error;
  worker = created.data.user;
}
const registration = await admin.schema("app").rpc("register_media_worker", {
  p_auth_user_id: worker.id,
  p_generation: generation,
});
if (registration.error) throw registration.error;
console.info("Media worker registered", {
  generation,
});
