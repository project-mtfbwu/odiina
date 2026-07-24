import { createClient } from "@supabase/supabase-js";

const users = [
  {
    email: "journey@example.test",
    displayName: "Journey Example",
  },
  {
    email: "vertical-slice-desktop@example.test",
    displayName: "Vertical Slice Desktop",
  },
  {
    email: "vertical-slice-mobile@example.test",
    displayName: "Vertical Slice Mobile",
  },
  {
    email: "calendar-journey-desktop@example.test",
    displayName: "Calendar Journey Desktop",
  },
  {
    email: "calendar-journey-mobile@example.test",
    displayName: "Calendar Journey Mobile",
  },
];
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

for (const user of users) {
  const existing = usersPage.users.find(
    (candidate) => candidate.email?.toLowerCase() === user.email,
  );
  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existing.id,
      {
        email_confirm: true,
        user_metadata: { display_name: user.displayName },
      },
    );
    if (updateError) {
      throw updateError;
    }
    continue;
  }

  const { error: createError } = await supabase.auth.admin.createUser({
    email: user.email,
    email_confirm: true,
    user_metadata: { display_name: user.displayName },
  });
  if (createError) {
    throw createError;
  }
}

console.log(`Created ${users.length} isolated local login-capable test users.`);
