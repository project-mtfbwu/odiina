import { writeFile } from "node:fs/promises";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const status = JSON.parse(input);
const apiUrl = status.API_URL;
const anonKey = status.ANON_KEY;

if (typeof apiUrl !== "string" || typeof anonKey !== "string") {
  console.error("Supabase status did not provide API_URL and ANON_KEY.");
  process.exit(2);
}

const parsedUrl = new URL(apiUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
  console.error("Refusing to write environment values for non-local Supabase.");
  process.exit(2);
}

const material = `# Generated from the running local Supabase stack.
SUPABASE_URL=${apiUrl}
SUPABASE_PUBLISHABLE_KEY=${anonKey}
ODIINA_APP_URL=http://localhost:3000
ODIINA_RATE_LIMIT_ADAPTER=memory
ODIINA_FEATURE_AI=false
ODIINA_FEATURE_UPLOADS=false
ODIINA_FEATURE_IMAGE_UPLOADS=false
ODIINA_FEATURE_VIDEO_UPLOADS=false
ODIINA_FEATURE_AUDIO_UPLOADS=false
ODIINA_FEATURE_WORKER=false
ODIINA_FEATURE_SHARING=false
ODIINA_FEATURE_PERIOD_REPORTS=false
`;

if (
  /(?:SERVICE_ROLE|SECRET_KEY|JWT_SECRET|DATABASE_PASSWORD|OPENAI_API_KEY)\s*=/i.test(
    material,
  )
) {
  console.error("Refusing to write privileged material into .env.local.");
  process.exit(2);
}

await writeFile(".env.local", material, { encoding: "utf8", mode: 0o600 });
console.log(
  "Wrote browser-safe local settings to ignored .env.local; feature flags remain false.",
);
