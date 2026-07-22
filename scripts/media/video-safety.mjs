import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

export const VIDEO_LIMITS = Object.freeze({
  maximumBytes: 250 * 1024 * 1024,
  minimumDurationMs: 250,
  maximumDurationMs: 5 * 60 * 1000,
  maximumPixels: 3840 * 2160,
  maximumDimension: 3840,
  maximumFrameRate: 60,
  maximumPlaybackDimension: 1920,
  maximumPlaybackPixels: 1920 * 1080,
  maximumPlaybackFrameRate: 30,
  maximumPlaybackBytes: 180 * 1024 * 1024,
  maximumPosterBytes: 2 * 1024 * 1024,
});

const policies = Object.freeze({
  webm: {
    mimeTypes: new Set(["video/webm"]),
    extensions: new Set(["webm"]),
    formats: new Set(["matroska,webm", "webm"]),
    videoCodecs: new Set(["vp8", "vp9"]),
    audioCodecs: new Set(["opus"]),
  },
  mp4: {
    mimeTypes: new Set(["video/mp4", "application/mp4"]),
    extensions: new Set(["mp4", "m4v"]),
    formats: new Set(["mov,mp4,m4a,3gp,3g2,mj2"]),
    videoCodecs: new Set(["h264"]),
    audioCodecs: new Set(["aac"]),
  },
  mov: {
    mimeTypes: new Set(["video/quicktime"]),
    extensions: new Set(["mov"]),
    formats: new Set(["mov,mp4,m4a,3gp,3g2,mj2"]),
    videoCodecs: new Set(["h264", "hevc"]),
    audioCodecs: new Set(["aac"]),
  },
});

const acceptedPixelFormats = new Set([
  "yuv420p",
  "yuvj420p",
  "yuv422p",
  "yuvj422p",
  "yuv444p",
  "yuvj444p",
  "nv12",
  "yuv420p10le",
]);
const rejectedHdrTransfers = new Set(["smpte2084", "arib-std-b67"]);

function safeCode(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function extensionOf(filename) {
  return /\.([a-z0-9]{1,8})$/i.exec(filename ?? "")?.[1]?.toLowerCase() ?? "";
}

export function detectVideoFamily(input) {
  if (
    input.length >= 4 &&
    input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    return "webm";
  }
  if (input.length >= 12 && input.subarray(4, 8).toString("ascii") === "ftyp") {
    return "iso_bmff";
  }
  throw safeCode("unsupported_video_signature");
}

export function validateVideoDeclaration({
  family,
  declaredMime,
  originalFilename,
}) {
  const mime = (declaredMime ?? "").toLowerCase();
  const extension = extensionOf(originalFilename);
  const container =
    family === "webm"
      ? "webm"
      : mime === "video/quicktime" && extension === "mov"
        ? "mov"
        : "mp4";
  const policy = policies[container];
  if (
    !policy ||
    !policy.mimeTypes.has(mime) ||
    !policy.extensions.has(extension) ||
    (family === "webm") !== (container === "webm")
  ) {
    throw safeCode("video_declaration_mismatch");
  }
  return container;
}

export function fractionValue(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : Number.NaN;
}

export function durationFromVideoPacketCsv(output) {
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

function run(binary, args, { timeoutMs, maximumOutputBytes = 512 * 1024 }) {
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
      finish(() => reject(safeCode("video_processor_timeout")));
    }, timeoutMs);
    child.on("error", () =>
      finish(() => reject(safeCode("video_processor_unavailable"))),
    );
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(safeCode("video_probe_resource_limit")));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 128 * 1024) stderr.push(chunk);
    });
    child.on("close", (code) =>
      finish(() => {
        if (code !== 0) {
          reject(safeCode("video_processor_failed"));
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
      "format=format_name,duration:format_tags:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,duration,color_space,color_transfer,color_primaries,disposition:stream_tags=rotate:stream_side_data=rotation",
      "-of",
      "json",
      path,
    ],
    { timeoutMs: 45_000, maximumOutputBytes: 512 * 1024 },
  );
  try {
    return JSON.parse(result.stdout.toString("utf8"));
  } catch {
    throw safeCode("video_probe_invalid");
  }
}

async function packetDuration(ffprobePath, path) {
  const result = await run(
    ffprobePath,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path,
    ],
    { timeoutMs: 45_000, maximumOutputBytes: 8 * 1024 * 1024 },
  );
  return durationFromVideoPacketCsv(result.stdout.toString("utf8"));
}

function rotationOf(stream) {
  const sideRotation = stream?.side_data_list?.find((item) =>
    Number.isFinite(Number(item?.rotation)),
  )?.rotation;
  const value = Number(sideRotation ?? stream?.tags?.rotate ?? 0);
  if (!Number.isFinite(value)) return 0;
  return (((Math.round(value / 90) * 90) % 360) + 360) % 360;
}

function validatedSource(probeResult, container, fallbackDurationSeconds) {
  const streams = Array.isArray(probeResult?.streams)
    ? probeResult.streams
    : [];
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  if (
    videos.length !== 1 ||
    audios.length > 1 ||
    streams.length !== videos.length + audios.length
  ) {
    throw safeCode("unexpected_video_stream");
  }
  const video = videos[0];
  const audio = audios[0];
  const policy = policies[container];
  if (
    !policy.formats.has(probeResult?.format?.format_name) ||
    !policy.videoCodecs.has(video.codec_name) ||
    (audio && !policy.audioCodecs.has(audio.codec_name))
  ) {
    throw safeCode("unsupported_video_codec");
  }
  const width = Number(video.width);
  const height = Number(video.height);
  const frameRate = fractionValue(video.avg_frame_rate || video.r_frame_rate);
  const declaredDuration = Number(
    video.duration ?? probeResult?.format?.duration,
  );
  const durationSeconds = Number.isFinite(declaredDuration)
    ? declaredDuration
    : fallbackDurationSeconds;
  const durationMs = Math.round(durationSeconds * 1000);
  if (
    !Number.isFinite(durationMs) ||
    durationMs < VIDEO_LIMITS.minimumDurationMs
  ) {
    throw safeCode("video_too_short");
  }
  if (durationMs > VIDEO_LIMITS.maximumDurationMs) {
    throw safeCode("video_duration_exceeded");
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > VIDEO_LIMITS.maximumDimension ||
    height > VIDEO_LIMITS.maximumDimension ||
    width * height > VIDEO_LIMITS.maximumPixels
  ) {
    throw safeCode("video_resolution_exceeded");
  }
  if (
    !Number.isFinite(frameRate) ||
    frameRate <= 0 ||
    frameRate > VIDEO_LIMITS.maximumFrameRate
  ) {
    throw safeCode("video_frame_rate_exceeded");
  }
  if (!acceptedPixelFormats.has(video.pix_fmt)) {
    throw safeCode("video_pixel_format_unsupported");
  }
  if (rejectedHdrTransfers.has(video.color_transfer)) {
    throw safeCode("video_hdr_unsupported");
  }
  return {
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    durationMs,
    width,
    height,
    frameRate,
    rotation: rotationOf(video),
  };
}

function validatePlayback(probeResult, source) {
  const streams = Array.isArray(probeResult?.streams)
    ? probeResult.streams
    : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (
    !video ||
    streams.length !== 1 + Number(Boolean(audio)) ||
    video.codec_name !== "h264" ||
    video.pix_fmt !== "yuv420p" ||
    (source.hasAudio ? audio?.codec_name !== "aac" : Boolean(audio))
  ) {
    throw safeCode("video_playback_invalid");
  }
  const width = Number(video.width);
  const height = Number(video.height);
  const frameRate = fractionValue(video.avg_frame_rate || video.r_frame_rate);
  const durationMs = Math.round(
    Number(video.duration ?? probeResult?.format?.duration) * 1000,
  );
  if (
    !Number.isFinite(durationMs) ||
    Math.abs(durationMs - source.durationMs) > 2000 ||
    width > VIDEO_LIMITS.maximumPlaybackDimension ||
    height > VIDEO_LIMITS.maximumPlaybackDimension ||
    width * height > VIDEO_LIMITS.maximumPlaybackPixels ||
    frameRate > VIDEO_LIMITS.maximumPlaybackFrameRate + 0.1
  ) {
    throw safeCode("video_playback_limits_invalid");
  }
  const forbiddenTag = Object.keys(probeResult?.format?.tags ?? {}).some(
    (key) =>
      /location|gps|author|comment|title|creation_time|device|make|model/i.test(
        key,
      ),
  );
  if (forbiddenTag) throw safeCode("video_metadata_not_stripped");
  return { width, height, frameRate, durationMs };
}

export async function assertVideoProcessorHealthy({ ffmpegPath, ffprobePath }) {
  await run(ffprobePath, ["-version"], {
    timeoutMs: 10_000,
    maximumOutputBytes: 128 * 1024,
  });
  const encoders = await run(ffmpegPath, ["-hide_banner", "-encoders"], {
    timeoutMs: 10_000,
    maximumOutputBytes: 2 * 1024 * 1024,
  });
  const output = encoders.stdout.toString("utf8");
  if (
    !/^\s*V\S*\s+libx264\s/m.test(output) ||
    !/^\s*A\S*\s+aac\s/m.test(output)
  ) {
    throw safeCode("video_encoder_unavailable");
  }
}

export async function prepareSafeVideo(
  input,
  { declaredMime, originalFilename, ffmpegPath, ffprobePath },
) {
  if (
    !Buffer.isBuffer(input) ||
    input.length < 12 ||
    input.length > VIDEO_LIMITS.maximumBytes
  ) {
    throw safeCode("video_source_size_invalid");
  }
  const family = detectVideoFamily(input);
  const container = validateVideoDeclaration({
    family,
    declaredMime,
    originalFilename,
  });
  const directory = await mkdtemp(join(tmpdir(), "odiina-video-"));
  const sourcePath = join(directory, `source.${container}`);
  const playbackPath = join(directory, "playback.mp4");
  const posterPath = join(directory, "poster-source.jpg");
  try {
    await writeFile(sourcePath, input, { flag: "wx", mode: 0o600 });
    const sourceProbe = await probe(ffprobePath, sourcePath);
    const videoStream = sourceProbe?.streams?.find(
      (stream) => stream.codec_type === "video",
    );
    const declaredDuration = Number(
      videoStream?.duration ?? sourceProbe?.format?.duration,
    );
    const fallbackDuration = Number.isFinite(declaredDuration)
      ? declaredDuration
      : await packetDuration(ffprobePath, sourcePath);
    const source = validatedSource(sourceProbe, container, fallbackDuration);
    const targetFrameRate = Math.min(
      VIDEO_LIMITS.maximumPlaybackFrameRate,
      Math.max(1, Math.round(source.frameRate * 1000) / 1000),
    );
    const portrait = source.height > source.width;
    const outputWidth = portrait ? 1080 : 1920;
    const outputHeight = portrait ? 1920 : 1080;
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
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        `scale=w='min(${outputWidth},iw)':h='min(${outputHeight},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,fps=${targetFrameRate}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        "4M",
        "-bufsize",
        "8M",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-metadata",
        "title=",
        "-metadata",
        "comment=",
        "-metadata",
        "creation_time=",
        playbackPath,
      ],
      { timeoutMs: 10 * 60 * 1000, maximumOutputBytes: 256 * 1024 },
    );
    const playbackInfo = await stat(playbackPath);
    if (
      playbackInfo.size <= 0 ||
      playbackInfo.size > VIDEO_LIMITS.maximumPlaybackBytes
    ) {
      throw safeCode("video_playback_size_invalid");
    }
    const playbackProbe = await probe(ffprobePath, playbackPath);
    const playbackMetadata = validatePlayback(playbackProbe, source);
    const posterSecond = Math.max(
      0,
      Math.min(1, source.durationMs / 1000 / 4),
    ).toFixed(3);
    await run(
      ffmpegPath,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        posterSecond,
        "-i",
        playbackPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        posterPath,
      ],
      { timeoutMs: 60_000, maximumOutputBytes: 128 * 1024 },
    );
    const poster = await sharp(await readFile(posterPath), {
      limitInputPixels: VIDEO_LIMITS.maximumPlaybackPixels,
      failOn: "warning",
    })
      .rotate()
      .resize({
        width: portrait ? 720 : 1280,
        height: portrait ? 1280 : 720,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (
      poster.data.length <= 0 ||
      poster.data.length > VIDEO_LIMITS.maximumPosterBytes ||
      !poster.info.width ||
      !poster.info.height
    ) {
      throw safeCode("video_poster_invalid");
    }
    return {
      container,
      ...source,
      playback: await readFile(playbackPath),
      playbackWidth: playbackMetadata.width,
      playbackHeight: playbackMetadata.height,
      playbackFrameRate: playbackMetadata.frameRate,
      playbackDurationMs: playbackMetadata.durationMs,
      poster: poster.data,
      posterWidth: poster.info.width,
      posterHeight: poster.info.height,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
