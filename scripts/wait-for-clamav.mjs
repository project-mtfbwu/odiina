import { spawnSync } from "node:child_process";

import { assertScannerHealthy } from "./media/clamav.mjs";

const maximumReadinessTimeoutMs = 4 * 60 * 1000;
const configuredReadinessTimeoutMs = Number(
  process.env.ODIINA_CLAMAV_READY_TIMEOUT_MS ?? maximumReadinessTimeoutMs,
);
const readinessTimeoutMs = Number.isFinite(configuredReadinessTimeoutMs)
  ? Math.min(
      Math.max(configuredReadinessTimeoutMs, 1_000),
      maximumReadinessTimeoutMs,
    )
  : maximumReadinessTimeoutMs;
const retryIntervalMs = 2_000;
const attemptTimeoutMs = 2_000;
const scanner = {
  host: process.env.ODIINA_CLAMAV_HOST ?? "127.0.0.1",
  port: Number(process.env.ODIINA_CLAMAV_PORT ?? "3310"),
  timeoutMs: attemptTimeoutMs,
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sanitizeDiagnostic(value) {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replace(
      /\b(password|passwd|token|secret|api[_-]?key)=\S+/giu,
      "$1=<redacted>",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1<redacted>@")
    .replace(/[^\P{C}\n\r\t]/gu, "")
    .slice(-32_000);
}

function printDockerDiagnostic(label, args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  console.error(`${label}:\n${sanitizeDiagnostic(output || "Unavailable")}`);
}

const startedAt = Date.now();
let attempts = 0;
let lastFailure = "scanner_unavailable";

while (Date.now() - startedAt < readinessTimeoutMs) {
  attempts += 1;
  try {
    await assertScannerHealthy(scanner);
    console.info(
      `ClamAV ready after ${Date.now() - startedAt} ms (${attempts} attempts).`,
    );
    process.exit(0);
  } catch (error) {
    lastFailure =
      error instanceof Error ? error.message : "scanner_unavailable";
  }

  const remainingMs = readinessTimeoutMs - (Date.now() - startedAt);
  if (remainingMs > 0) {
    await delay(Math.min(retryIntervalMs, remainingMs));
  }
}

console.error(
  `ClamAV readiness timed out after ${readinessTimeoutMs} ms (${attempts} attempts; last failure: ${lastFailure}).`,
);
printDockerDiagnostic("ClamAV container status", [
  "compose",
  "-f",
  "compose.media.yml",
  "ps",
  "clamav",
]);
printDockerDiagnostic("Sanitized ClamAV logs", [
  "compose",
  "-f",
  "compose.media.yml",
  "logs",
  "--no-color",
  "--tail",
  "200",
  "clamav",
]);
process.exit(1);
