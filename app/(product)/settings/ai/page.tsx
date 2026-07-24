import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { AiSettingsForm } from "@/components/ai-settings-form";
import { getAiRuntimeStatus } from "@/lib/ai/config";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getAiSettings, getAiUsage } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Private AI settings" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const [settings, usage, cookieStore] = await Promise.all([
    getAiSettings(),
    getAiUsage(),
    cookies(),
  ]);
  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <Link className="back-link" href="/settings">
            ← Back to Settings
          </Link>
          <p className="eyebrow mt-5">Explicit consent</p>
          <h1 className="page-title">Private AI</h1>
          <p className="page-description">
            Control transcription, searchable transcripts, evidence-linked
            insights and Odiina Chat independently. Originals remain private and
            unchanged.
          </p>
        </div>
      </header>
      <section
        className="panel p-5 sm:p-7"
        aria-labelledby="ai-controls-heading"
      >
        <h2 id="ai-controls-heading" className="mt-0 text-xl font-bold">
          AI privacy controls
        </h2>
        <AiSettingsForm
          initial={settings}
          usage={usage}
          runtime={getAiRuntimeStatus()}
          csrfToken={cookieStore.get(csrfCookieName)?.value ?? ""}
        />
      </section>
    </div>
  );
}
