import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const clientRoot = path.resolve(".next", "static");
const forbidden = [
  ["Supabase privileged-key variable", /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/i],
  ["OpenAI key variable", /OPENAI_API_KEY/i],
  ["OpenAI-style secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/],
  ["worker credential", /ODIINA_WORKER_(?:SECRET|TOKEN|KEY)/i],
  ["database credential variable", /DATABASE_(?:URL|PASSWORD)/i],
  ["Postgres connection string", /postgres(?:ql)?:\/\/[^"'`\s]+/i],
  ["database test fixture", /Owner [AB] (?:first|second|revised) Entry/i],
  ["seed Entry fixture", /Synthetic seed Entry/i],
];

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    }),
  );
  return nested.flat();
}

let files;
try {
  files = await filesBelow(clientRoot);
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    console.error(
      "Client output is missing. Run `pnpm build` before this scan.",
    );
    process.exit(2);
  }
  throw error;
}

const findings = [];
for (const file of files) {
  const material = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(material)) {
      findings.push(`${label}: ${path.relative(process.cwd(), file)}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Forbidden credential or private-fixture markers found:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Client credential scan passed (${files.length} static files).`);
