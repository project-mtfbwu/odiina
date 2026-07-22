import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { assertScannerHealthy, scanBuffer } from "./media/clamav.mjs";
import {
  assertAudioProcessorHealthy,
  prepareSafeAudio,
} from "./media/audio-safety.mjs";
import { prepareSafeImage, sha256 } from "./media/image-safety.mjs";
import {
  assertVideoProcessorHealthy,
  prepareSafeVideo,
} from "./media/video-safety.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "ODIINA_MEDIA_WORKER_EMAIL",
  "ODIINA_MEDIA_WORKER_PASSWORD",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const scanner = {
  host: process.env.ODIINA_CLAMAV_HOST ?? "127.0.0.1",
  port: Number(process.env.ODIINA_CLAMAV_PORT ?? "3310"),
  timeoutMs: Number(process.env.ODIINA_CLAMAV_TIMEOUT_MS ?? "15000"),
};
const once = process.argv.includes("--once");
const audioProcessor = {
  ffmpegPath: process.env.ODIINA_FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.ODIINA_FFPROBE_PATH ?? "ffprobe",
};
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: true } },
);

function rpcError(error) {
  if (error) throw new Error(error.message || "worker_rpc_failed");
}

async function heartbeat(job, stage) {
  const { error } = await supabase.schema("app").rpc("heartbeat_media_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_stage: stage,
    p_visibility_seconds: 180,
  });
  rpcError(error);
}

async function uploadImmutable(bucket, key, bytes, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(key, bytes, { contentType, upsert: false, cacheControl: "0" });
  if (!error) return;
  if (!/already exists|duplicate/i.test(error.message)) throw error;
  const existing = await supabase.storage.from(bucket).download(key);
  if (existing.error || !existing.data) throw error;
  const stored = Buffer.from(await existing.data.arrayBuffer());
  if (!sha256(stored).equals(sha256(bytes))) {
    throw new Error("immutable_object_conflict");
  }
}

async function processJob(job) {
  if (job.committed) {
    await supabase.storage
      .from(job.quarantine_bucket)
      .remove([job.quarantine_key]);
    const result = await supabase.schema("app").rpc("finish_media_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
    });
    rpcError(result.error);
    return;
  }

  await heartbeat(job, "checking");
  const downloaded = await supabase.storage
    .from(job.quarantine_bucket)
    .download(job.quarantine_key);
  if (downloaded.error || !downloaded.data)
    throw new Error("quarantine_download_failed");
  const input = Buffer.from(await downloaded.data.arrayBuffer());
  const quarantineHash = sha256(input);

  await heartbeat(job, "scanning");
  await assertScannerHealthy(scanner);
  const scan = await scanBuffer(input, scanner);
  if (!scan.clean) {
    const rejected = await supabase.schema("app").rpc("fail_media_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_error_code: "malware_detected",
      p_retryable: false,
      p_rejected: true,
    });
    rpcError(rejected.error);
    return;
  }

  if (job.media_kind === "image") {
    await heartbeat(job, "preparing");
    const purposeResult = await supabase
      .schema("app")
      .rpc("processing_media_purpose", { p_attachment_id: job.attachment_id });
    rpcError(purposeResult.error);
    const prepared = await prepareSafeImage(input, purposeResult.data);
    await uploadImmutable(
      "odiina-originals",
      job.original_key,
      input,
      `image/${prepared.format}`,
    );
    await uploadImmutable(
      "odiina-display",
      job.display_key,
      prepared.display.data,
      "image/jpeg",
    );
    await uploadImmutable(
      "odiina-ai",
      job.ai_key,
      prepared.ai.data,
      "image/jpeg",
    );

    await heartbeat(job, "promoting");
    const commit = await supabase.schema("app").rpc("commit_processed_image", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_input_format: prepared.format,
      p_input_width: prepared.inputWidth,
      p_input_height: prepared.inputHeight,
      p_display_width: prepared.display.info.width,
      p_display_height: prepared.display.info.height,
      p_ai_width: prepared.ai.info.width,
      p_ai_height: prepared.ai.info.height,
      p_quarantine_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_quarantine_bytes: input.length,
      p_original_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_original_bytes: input.length,
      p_display_sha256: `\\x${sha256(prepared.display.data).toString("hex")}`,
      p_display_bytes: prepared.display.data.length,
      p_ai_sha256: `\\x${sha256(prepared.ai.data).toString("hex")}`,
      p_ai_bytes: prepared.ai.data.length,
    });
    rpcError(commit.error);
  } else if (job.media_kind === "audio") {
    await heartbeat(job, "validating");
    const prepared = await prepareSafeAudio(input, {
      declaredMime: job.declared_mime,
      originalFilename: job.original_filename,
      ...audioProcessor,
    });
    await heartbeat(job, "transcoding");
    const detectedOriginalMime =
      prepared.container === "webm"
        ? "audio/webm"
        : prepared.container === "ogg"
          ? "audio/ogg"
          : "audio/mp4";
    await uploadImmutable(
      "odiina-originals",
      job.original_key,
      input,
      detectedOriginalMime,
    );
    await uploadImmutable(
      "odiina-playback",
      job.playback_key,
      prepared.playback,
      "audio/mp4",
    );
    await heartbeat(job, "waveform");
    const commit = await supabase.schema("app").rpc("commit_processed_audio", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_input_container: prepared.container,
      p_input_codec: prepared.codec,
      p_input_duration_ms: prepared.durationMs,
      p_input_channels: prepared.channels,
      p_input_sample_rate: prepared.sampleRate,
      p_quarantine_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_quarantine_bytes: input.length,
      p_original_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_original_bytes: input.length,
      p_playback_sha256: `\\x${sha256(prepared.playback).toString("hex")}`,
      p_playback_bytes: prepared.playback.length,
      p_playback_duration_ms: prepared.playbackDurationMs,
      p_waveform_peaks: prepared.waveformPeaks,
    });
    rpcError(commit.error);
  } else if (job.media_kind === "video") {
    await heartbeat(job, "validating");
    const prepared = await prepareSafeVideo(input, {
      declaredMime: job.declared_mime,
      originalFilename: job.original_filename,
      ...audioProcessor,
    });
    await heartbeat(job, "transcoding");
    const detectedOriginalMime =
      prepared.container === "webm"
        ? "video/webm"
        : prepared.container === "mov"
          ? "video/quicktime"
          : "video/mp4";
    await uploadImmutable(
      "odiina-originals",
      job.original_key,
      input,
      detectedOriginalMime,
    );
    await uploadImmutable(
      "odiina-playback",
      job.playback_key,
      prepared.playback,
      "video/mp4",
    );
    await heartbeat(job, "poster");
    await uploadImmutable(
      "odiina-posters",
      job.poster_key,
      prepared.poster,
      "image/jpeg",
    );
    await heartbeat(job, "promoting");
    const commit = await supabase.schema("app").rpc("commit_processed_video", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_input_container: prepared.container,
      p_input_video_codec: prepared.videoCodec,
      p_input_audio_codec: prepared.audioCodec,
      p_input_duration_ms: prepared.durationMs,
      p_input_width: prepared.width,
      p_input_height: prepared.height,
      p_input_frame_rate: prepared.frameRate,
      p_input_rotation: prepared.rotation,
      p_has_audio: prepared.hasAudio,
      p_quarantine_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_quarantine_bytes: input.length,
      p_original_sha256: `\\x${quarantineHash.toString("hex")}`,
      p_original_bytes: input.length,
      p_playback_sha256: `\\x${sha256(prepared.playback).toString("hex")}`,
      p_playback_bytes: prepared.playback.length,
      p_playback_duration_ms: prepared.playbackDurationMs,
      p_playback_width: prepared.playbackWidth,
      p_playback_height: prepared.playbackHeight,
      p_playback_frame_rate: prepared.playbackFrameRate,
      p_poster_sha256: `\\x${sha256(prepared.poster).toString("hex")}`,
      p_poster_bytes: prepared.poster.length,
      p_poster_width: prepared.posterWidth,
      p_poster_height: prepared.posterHeight,
    });
    rpcError(commit.error);
  } else {
    throw new Error("media_kind_unimplemented");
  }

  await heartbeat(job, "cleanup");
  const removal = await supabase.storage
    .from(job.quarantine_bucket)
    .remove([job.quarantine_key]);
  if (removal.error) throw new Error("quarantine_cleanup_failed");
  const finish = await supabase.schema("app").rpc("finish_media_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
  });
  rpcError(finish.error);
}

function safeProcessingCode(error) {
  return error instanceof Error && /^[a-z0-9_]{1,64}$/.test(error.message)
    ? error.message
    : "processing_failed";
}

async function fail(job, error) {
  const code = safeProcessingCode(error);
  const rejected = [
    "unsupported_signature",
    "image_truncated",
    "image_too_large",
    "image_dimensions_invalid",
    "animated_image_rejected",
    "unsupported_audio_signature",
    "audio_declaration_mismatch",
    "unexpected_media_stream",
    "unsupported_audio_codec",
    "audio_too_short",
    "audio_duration_exceeded",
    "audio_channels_unsupported",
    "audio_sample_rate_unsupported",
    "audio_source_size_invalid",
    "audio_decode_empty",
    "audio_playback_invalid",
    "audio_playback_duration_mismatch",
    "unsupported_video_signature",
    "video_declaration_mismatch",
    "unexpected_video_stream",
    "unsupported_video_codec",
    "video_too_short",
    "video_duration_exceeded",
    "video_resolution_exceeded",
    "video_frame_rate_exceeded",
    "video_pixel_format_unsupported",
    "video_hdr_unsupported",
    "video_source_size_invalid",
    "video_playback_size_invalid",
    "video_playback_invalid",
    "video_playback_limits_invalid",
    "video_metadata_not_stripped",
    "video_poster_invalid",
  ].includes(code);
  const retryable = [
    "scanner_timeout",
    "scanner_unavailable",
    "scanner_unhealthy",
    "quarantine_download_failed",
    "quarantine_cleanup_failed",
    "audio_processor_timeout",
    "audio_processor_unavailable",
    "audio_processor_failed",
    "video_processor_timeout",
    "video_processor_unavailable",
    "video_processor_failed",
    "video_probe_resource_limit",
  ].includes(code);
  const result = await supabase.schema("app").rpc("fail_media_job", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_error_code: code,
    p_retryable: retryable,
    p_rejected: rejected,
  });
  if (result.error) {
    console.error("media_job_failure_record_failed", {
      jobId: job.job_id,
      code: result.error.code,
    });
  }
}

await assertAudioProcessorHealthy(audioProcessor);
await assertVideoProcessorHealthy(audioProcessor);

const login = await supabase.auth.signInWithPassword({
  email: process.env.ODIINA_MEDIA_WORKER_EMAIL,
  password: process.env.ODIINA_MEDIA_WORKER_PASSWORD,
});
if (login.error) throw new Error("Worker sign-in failed");

do {
  const claimed = await supabase
    .schema("app")
    .rpc("claim_media_job", { p_visibility_seconds: 180 });
  rpcError(claimed.error);
  const job = claimed.data?.[0];
  if (!job) {
    const orphaned = await supabase
      .schema("app")
      .rpc("claim_media_orphan", { p_stale_seconds: 7200 });
    rpcError(orphaned.error);
    const orphan = orphaned.data?.[0];
    if (orphan) {
      const removal = await supabase.storage
        .from(orphan.quarantine_bucket)
        .remove([orphan.quarantine_key]);
      if (removal.error) throw new Error("orphan_cleanup_failed");
      const completed = await supabase
        .schema("app")
        .rpc("complete_media_orphan", {
          p_job_id: orphan.job_id,
          p_lease_token: orphan.lease_token,
        });
      rpcError(completed.error);
      console.info("media_orphan_reconciled", {
        jobId: orphan.job_id,
        attachmentId: orphan.attachment_id,
      });
      continue;
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    continue;
  }
  try {
    await processJob(job);
    console.info("media_job_completed", { jobId: job.job_id });
  } catch (error) {
    console.error("media_job_failed", {
      jobId: job.job_id,
      code: safeProcessingCode(error),
    });
    await fail(job, error);
  }
} while (!once);
