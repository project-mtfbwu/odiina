import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const AUDIO_LIMITS = Object.freeze({
  maximumBytes: 25 * 1024 * 1024,
  minimumDurationMs: 250,
  maximumDurationMs: 10 * 60 * 1000,
  maximumChannels: 2,
  maximumSampleRate: 96_000,
  waveformPeaks: 96,
});

const sourcePolicies = Object.freeze({
  webm: {
    mimeTypes: new Set(["audio/webm"]),
    extensions: new Set(["webm"]),
    formats: new Set(["matroska,webm", "webm"]),
    codecs: new Set(["opus"]),
  },
  ogg: {
    mimeTypes: new Set(["audio/ogg"]),
    extensions: new Set(["ogg", "oga"]),
    formats: new Set(["ogg"]),
    codecs: new Set(["opus"]),
  },
  m4a: {
    mimeTypes: new Set(["audio/mp4", "audio/x-m4a"]),
    extensions: new Set(["m4a", "mp4"]),
    formats: new Set(["mov,mp4,m4a,3gp,3g2,mj2"]),
    codecs: new Set(["aac"]),
  },
});

function safeCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function extensionOf(filename) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(filename ?? "");
  return match?.[1]?.toLowerCase() ?? "";
}

export function detectAudioContainer(input) {
  if (
    input.length >= 4 &&
    input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    return "webm";
  }
  if (input.length >= 4 && input.subarray(0, 4).toString("ascii") === "OggS") {
    return "ogg";
  }
  if (input.length >= 12 && input.subarray(4, 8).toString("ascii") === "ftyp") {
    return "m4a";
  }
  throw safeCode("unsupported_audio_signature");
}

export function validateAudioDeclaration({
  container,
  declaredMime,
  originalFilename,
}) {
  const policy = sourcePolicies[container];
  if (
    !policy ||
    !policy.mimeTypes.has((declaredMime ?? "").toLowerCase()) ||
    !policy.extensions.has(extensionOf(originalFilename))
  ) {
    throw safeCode("audio_declaration_mismatch");
  }
}

function run(
  binary,
  args,
  { timeoutMs = 120_000, maximumOutputBytes = 12 * 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(safeCode("audio_processor_timeout")));
    }, timeoutMs);
    child.on("error", () =>
      finish(() => reject(safeCode("audio_processor_unavailable"))),
    );
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(safeCode("audio_decoded_resource_limit")));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on("close", (code) =>
      finish(() => {
        if (code !== 0) {
          reject(safeCode("audio_processor_failed"));
          return;
        }
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      }),
    );
  });
}

async function probe(ffprobePath, path) {
  const result = await run(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name,duration:stream=index,codec_type,codec_name,sample_rate,channels,duration,disposition",
      "-of",
      "json",
      path,
    ],
    { timeoutMs: 30_000, maximumOutputBytes: 256 * 1024 },
  );
  try {
    return JSON.parse(result.stdout.toString("utf8"));
  } catch {
    throw safeCode("audio_probe_invalid");
  }
}

export function durationFromPacketCsv(output) {
  let durationSeconds = Number.NaN;
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const [timestampValue, durationValue] = line.split(",");
    const timestamp = Number(timestampValue);
    const packetDuration = Number(durationValue);
    if (!Number.isFinite(timestamp)) continue;
    durationSeconds = Math.max(
      Number.isFinite(durationSeconds) ? durationSeconds : 0,
      timestamp + (Number.isFinite(packetDuration) ? packetDuration : 0),
    );
  }
  return durationSeconds;
}

async function probePacketDuration(ffprobePath, path) {
  const result = await run(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path,
    ],
    { timeoutMs: 30_000, maximumOutputBytes: 4 * 1024 * 1024 },
  );
  return durationFromPacketCsv(result.stdout.toString("utf8"));
}

function validatedProbe(probeResult, container, fallbackDurationSeconds) {
  const streams = Array.isArray(probeResult?.streams)
    ? probeResult.streams
    : [];
  if (streams.length !== 1 || streams[0]?.codec_type !== "audio") {
    throw safeCode("unexpected_media_stream");
  }
  const stream = streams[0];
  const policy = sourcePolicies[container];
  if (
    !policy.formats.has(probeResult?.format?.format_name) ||
    !policy.codecs.has(stream.codec_name)
  ) {
    throw safeCode("unsupported_audio_codec");
  }
  const declaredDurationSeconds = Number(
    stream.duration ?? probeResult?.format?.duration,
  );
  const durationSeconds = Number.isFinite(declaredDurationSeconds)
    ? declaredDurationSeconds
    : fallbackDurationSeconds;
  const durationMs = Math.round(durationSeconds * 1000);
  const channels = Number(stream.channels);
  const sampleRate = Number(stream.sample_rate);
  if (
    !Number.isFinite(durationMs) ||
    durationMs < AUDIO_LIMITS.minimumDurationMs
  ) {
    throw safeCode("audio_too_short");
  }
  if (durationMs > AUDIO_LIMITS.maximumDurationMs) {
    throw safeCode("audio_duration_exceeded");
  }
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > AUDIO_LIMITS.maximumChannels
  ) {
    throw safeCode("audio_channels_unsupported");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > AUDIO_LIMITS.maximumSampleRate
  ) {
    throw safeCode("audio_sample_rate_unsupported");
  }
  return {
    codec: stream.codec_name,
    durationMs,
    channels,
    sampleRate,
  };
}

function waveformFromPcm(pcm) {
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) throw safeCode("audio_decode_empty");
  const raw = Array.from({ length: AUDIO_LIMITS.waveformPeaks }, () => 0);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const bucket = Math.min(
      AUDIO_LIMITS.waveformPeaks - 1,
      Math.floor((sample / sampleCount) * AUDIO_LIMITS.waveformPeaks),
    );
    raw[bucket] = Math.max(raw[bucket], Math.abs(pcm.readInt16LE(sample * 2)));
  }
  const maximum = Math.max(...raw);
  return maximum === 0
    ? raw
    : raw.map((peak) => Math.round((peak / maximum) * 1000));
}

export async function assertAudioProcessorHealthy({ ffmpegPath, ffprobePath }) {
  await run(ffprobePath, ["-version"], {
    timeoutMs: 10_000,
    maximumOutputBytes: 128 * 1024,
  });
  const encoders = await run(ffmpegPath, ["-hide_banner", "-encoders"], {
    timeoutMs: 10_000,
    maximumOutputBytes: 2 * 1024 * 1024,
  });
  if (!/^\s*A\S*\s+aac\s/m.test(encoders.stdout.toString("utf8"))) {
    throw safeCode("audio_aac_encoder_unavailable");
  }
}

export async function prepareSafeAudio(
  input,
  { declaredMime, originalFilename, ffmpegPath, ffprobePath },
) {
  if (
    !Buffer.isBuffer(input) ||
    input.length < 12 ||
    input.length > AUDIO_LIMITS.maximumBytes
  ) {
    throw safeCode("audio_source_size_invalid");
  }
  const container = detectAudioContainer(input);
  validateAudioDeclaration({ container, declaredMime, originalFilename });
  const directory = await mkdtemp(join(tmpdir(), "odiina-audio-"));
  const sourcePath = join(
    directory,
    `source.${container === "m4a" ? "m4a" : container}`,
  );
  const playbackPath = join(directory, "playback.m4a");
  try {
    await writeFile(sourcePath, input, { flag: "wx", mode: 0o600 });
    const sourceProbe = await probe(ffprobePath, sourcePath);
    const sourceStream = Array.isArray(sourceProbe?.streams)
      ? sourceProbe.streams[0]
      : undefined;
    const declaredDuration = Number(
      sourceStream?.duration ?? sourceProbe?.format?.duration,
    );
    const fallbackDuration = Number.isFinite(declaredDuration)
      ? declaredDuration
      : await probePacketDuration(ffprobePath, sourcePath);
    const inputMetadata = validatedProbe(
      sourceProbe,
      container,
      fallbackDuration,
    );
    await run(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        playbackPath,
      ],
      { timeoutMs: 120_000, maximumOutputBytes: 128 * 1024 },
    );
    const playback = await readFile(playbackPath);
    if (playback.length === 0 || playback.length > 12 * 1024 * 1024) {
      throw safeCode("audio_playback_size_invalid");
    }
    const outputProbe = await probe(ffprobePath, playbackPath);
    const outputStreams = Array.isArray(outputProbe?.streams)
      ? outputProbe.streams
      : [];
    if (
      outputStreams.length !== 1 ||
      outputStreams[0]?.codec_type !== "audio" ||
      outputStreams[0]?.codec_name !== "aac" ||
      Number(outputStreams[0]?.channels) !== 1 ||
      Number(outputStreams[0]?.sample_rate) !== 48000
    ) {
      throw safeCode("audio_playback_invalid");
    }
    const playbackDurationMs = Math.round(
      Number(outputStreams[0]?.duration ?? outputProbe?.format?.duration) *
        1000,
    );
    if (
      !Number.isFinite(playbackDurationMs) ||
      Math.abs(playbackDurationMs - inputMetadata.durationMs) > 1000
    ) {
      throw safeCode("audio_playback_duration_mismatch");
    }
    const decoded = await run(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        playbackPath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "8000",
        "pipe:1",
      ],
      { timeoutMs: 120_000, maximumOutputBytes: 10 * 1024 * 1024 },
    );
    return {
      container,
      ...inputMetadata,
      playback,
      playbackDurationMs,
      waveformPeaks: waveformFromPcm(decoded.stdout),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
