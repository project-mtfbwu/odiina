import { createClient } from "@supabase/supabase-js";

const email = "journey@example.test";
const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.ODIINA_E2E_SUPABASE_URL;
const serviceRoleKey = process.env.ODIINA_E2E_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Set SUPABASE_URL and ODIINA_E2E_SERVICE_ROLE_KEY from `supabase status -o env`.",
  );
  process.exit(2);
}

const localUrl = new URL(supabaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(localUrl.hostname)) {
  console.error("Refusing to manage a test user outside local Supabase.");
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const { data: usersPage, error: listError } =
  await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) {
  throw listError;
}

const existing = usersPage.users.find(
  (candidate) => candidate.email?.toLowerCase() === email,
);
if (existing) {
  const { error } = await supabase.auth.admin.deleteUser(existing.id, false);
  if (error) {
    throw error;
  }
}

const { error: createError } = await supabase.auth.admin.createUser({
  email,
  email_confirm: true,
  user_metadata: { display_name: "Journey Example" },
});
if (createError) {
  throw createError;
}

console.log(`Created local login-capable test user ${email}.`);
