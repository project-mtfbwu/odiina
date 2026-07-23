import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  assertProviderOutputSize,
  FakeInsightProvider,
  FakeTranscriptionProvider,
} from "./ai/fake-providers.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "ODIINA_AI_WORKER_EMAIL",
  "ODIINA_AI_WORKER_PASSWORD",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
const url = new URL(process.env.SUPABASE_URL);
const fakeAllowed =
  process.env.ODIINA_AI_PROVIDER === "fake" &&
  process.env.ODIINA_ALLOW_FAKE_AI === "true" &&
  ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
if (!fakeAllowed) {
  throw new Error(
    "No approved live AI provider is configured. Fake AI requires explicit loopback-only flags.",
  );
}

const once = process.argv.includes("--once");
const transcriptionProvider = new FakeTranscriptionProvider();
const insightProvider = new FakeInsightProvider();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: true } },
);

function rpcError(error) {
  if (error) throw new Error(error.message || "ai_worker_rpc_failed");
}

async function heartbeat(job, stage) {
  const result = await supabase.schema("app").rpc("heartbeat_ai_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_stage: stage,
    p_visibility_seconds: 180,
  });
  rpcError(result.error);
}

async function fail(job, error) {
  const code =
    error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
      ? error.message
      : "provider_failed";
  const retryable = ["provider_timeout", "provider_rate_limited"].includes(
    code,
  );
  const result = await supabase.schema("app").rpc("fail_ai_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_error_code: code,
    p_retryable: retryable,
  });
  rpcError(result.error);
}

async function processJob(job) {
  if (job.provider_id !== "fake-local")
    throw new Error("provider_not_allowlisted");
  if (job.job_kind === "transcription") {
    await heartbeat(job, "transcribing");
    const output = assertProviderOutputSize(
      await transcriptionProvider.transcribe({
        jobId: job.job_id,
        durationMs: job.source_duration_ms,
        languageHint: job.language_hint,
        fixture: process.env.ODIINA_AI_FAKE_FIXTURE,
      }),
    );
    await heartbeat(job, "processing_response");
    const result = await supabase
      .schema("app")
      .rpc("finish_transcription_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_output: output,
      });
    rpcError(result.error);
  } else {
    await heartbeat(job, "generating");
    const output = assertProviderOutputSize(
      await insightProvider.generate({
        jobId: job.job_id,
        evidence: job.source_snapshot,
        maximumOutputCharacters: 20_000,
        idempotencyKey: job.client_request_id,
      }),
    );
    const result = await supabase.schema("app").rpc("finish_insight_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_output: output,
    });
    rpcError(result.error);
  }
}

const signedIn = await supabase.auth.signInWithPassword({
  email: process.env.ODIINA_AI_WORKER_EMAIL,
  password: process.env.ODIINA_AI_WORKER_PASSWORD,
});
if (signedIn.error) throw signedIn.error;

do {
  const claimed = await supabase
    .schema("app")
    .rpc("claim_ai_job", { p_visibility_seconds: 180 });
  rpcError(claimed.error);
  const job = claimed.data?.[0];
  if (!job) {
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    continue;
  }
  try {
    await processJob(job);
    console.info("AI job completed", { jobId: job.job_id, kind: job.job_kind });
  } catch (error) {
    try {
      await fail(job, error);
    } catch (failError) {
      console.error("AI job failure could not be recorded", {
        jobId: job.job_id,
        code: failError instanceof Error ? failError.message : "unknown",
      });
    }
  }
} while (!once);
