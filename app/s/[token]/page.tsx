import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicReport } from "@/lib/reports/public";
import {
  localRateLimiter,
  privacySafeRateLimitKey,
} from "@/lib/security/rate-limit";

export const metadata: Metadata = {
  title: "Shared Odiina recap",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, headerStore] = await Promise.all([params, headers()]);
  const forwarded =
    headerStore.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const allowed = localRateLimiter.take(
    privacySafeRateLimitKey(`${token}:${forwarded}`),
    120,
    60,
  );
  if (!allowed.allowed) notFound();
  const report = await resolvePublicReport(token);
  if (!report) notFound();
  if (report.state !== "active")
    return (
      <main className="shared-story">
        <header>
          <span className="shared-wordmark">Odiina</span>
          <p className="eyebrow">Shared recap unavailable</p>
          <h1>
            {report.state === "expired"
              ? "This share expired"
              : "This share was revoked"}
          </h1>
          <p>
            No report content or private source data is available through this
            link.
          </p>
        </header>
      </main>
    );
  return (
    <main className="shared-story">
      <header>
        <span className="shared-wordmark">Odiina</span>
        <p className="eyebrow">Shared recap · read-only snapshot</p>
        <h1>{report.title}</h1>
        <p>
          {report.periodStart} — {report.periodEnd}
        </p>
        <small>
          Expires {new Date(report.expiresAt).toLocaleString()}. The sender can
          revoke this link at any time; viewers can still copy or screenshot it.
        </small>
      </header>
      {report.sections.map((section) => (
        <section key={`${section.kind}-${section.heading}`}>
          <h2>{section.heading}</h2>
          {section.content
            .split("\n")
            .map((paragraph, index) =>
              paragraph ? <p key={index}>{paragraph}</p> : null,
            )}
        </section>
      ))}
      <footer>
        <strong>Odiina</strong>
        <span>
          No tracking, comments, likes, discovery or private navigation.
        </span>
      </footer>
    </main>
  );
}
