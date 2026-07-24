import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/lib/environment";
import type { PublicReportResolution, ReportDetail } from "@/lib/reports/types";

export async function resolvePublicReport(
  token: string,
): Promise<PublicReportResolution | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const environment = getServerEnvironment();
  const supabase = createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .schema("app")
    .rpc("resolve_report_share", { p_token: token });
  if (error) return null;
  const value = (data as { manifest: PublicReportResolution }[] | null)?.[0]
    ?.manifest;
  return value ?? null;
}

export function reportMarkdown(report: ReportDetail): string {
  const safeText = (value: string) =>
    value
      .replaceAll("\\", "\\\\")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/([`*_[\]{}()#!|])/g, "\\$1");
  const metrics = report.metrics
    .map(
      (metric) =>
        `- ${metric.metric_key.replaceAll("_", " ")}: ${metric.metric_value}`,
    )
    .join("\n");
  const timeline = report.sources
    .filter((source) => source.selected && !source.source_unavailable)
    .map(
      (source) =>
        `### ${source.occurred_local_date}\n\n${safeText(source.body_excerpt || "Media moment")}`,
    )
    .join("\n\n");
  return `# ${safeText(report.title)}\n\n${report.period_start} to ${report.period_end}\n\n> Private Odiina ${report.generation_mode === "ai_enhanced" ? "AI-enhanced" : "factual"} report. Exported media and exact coordinates are omitted.\n\n${report.introduction ? `${safeText(report.introduction)}\n\n` : ""}## At a glance\n\n${metrics}\n\n## Timeline\n\n${timeline || "No moments included."}\n\n${report.closing_reflection ? `## Reflection\n\n${safeText(report.closing_reflection)}\n` : ""}`;
}
