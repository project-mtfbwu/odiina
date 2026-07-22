import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertAudioProcessorHealthy,
  prepareSafeAudio,
} from "./media/audio-safety.mjs";

const ffmpegPath = process.env.ODIINA_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.ODIINA_FFPROBE_PATH ?? "ffprobe";

function execute(binary, args, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("fixture_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(`fixture_failed:${Buffer.concat(stderr).toString("utf8")}`),
        );
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

async function expectCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof Error && error.message === code,
  );
}

await assertAudioProcessorHealthy({ ffmpegPath, ffprobePath });
const directory = await mkdtemp(join(tmpdir(), "odiina-audio-cert-"));
try {
  const fixtures = [
    {
      name: "voice.webm",
      mime: "audio/webm",
      codec: ["-c:a", "libopus"],
    },
    {
      name: "voice.ogg",
      mime: "audio/ogg",
      codec: ["-c:a", "libopus"],
    },
    {
      name: "voice.m4a",
      mime: "audio/mp4",
      codec: ["-c:a", "aac", "-b:a", "96k"],
    },
  ];

  for (const fixture of fixtures) {
    const path = join(directory, fixture.name);
    await execute(ffmpegPath, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-metadata",
      "title=private fixture title",
      "-metadata",
      "comment=private fixture comment",
      ...fixture.codec,
      path,
    ]);
    const input = await readFile(path);
    const prepared = await prepareSafeAudio(input, {
      declaredMime: fixture.mime,
      originalFilename: fixture.name,
      ffmpegPath,
      ffprobePath,
    });
    assert.equal(prepared.waveformPeaks.length, 96);
    assert.ok(
      prepared.waveformPeaks.every((peak) => peak >= 0 && peak <= 1000),
    );
    assert.ok(prepared.durationMs >= 900 && prepared.durationMs <= 1100);
    assert.ok(
      prepared.playbackDurationMs >= 900 && prepared.playbackDurationMs <= 1100,
    );
    assert.equal(prepared.playback.subarray(4, 8).toString("ascii"), "ftyp");

    const playbackPath = join(directory, `normalized-${fixture.name}.m4a`);
    await writeFile(playbackPath, prepared.playback);
    const probe = JSON.parse(
      (
        await execute(ffprobePath, [
          "-v",
          "error",
          "-show_entries",
          "format_tags:stream=codec_type,codec_name,channels,sample_rate:stream_tags",
          "-of",
          "json",
          playbackPath,
        ])
      ).toString("utf8"),
    );
    assert.equal(probe.streams.length, 1);
    assert.equal(probe.streams[0].codec_type, "audio");
    assert.equal(probe.streams[0].codec_name, "aac");
    assert.equal(Number(probe.streams[0].channels), 1);
    assert.equal(Number(probe.streams[0].sample_rate), 48000);
    assert.equal(probe.format?.tags?.title, undefined);
    assert.equal(probe.format?.tags?.comment, undefined);
  }

  const webm = await readFile(join(directory, "voice.webm"));
  const streamingWebm = await execute(ffmpegPath, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:a",
    "libopus",
    "-f",
    "webm",
    "pipe:1",
  ]);
  const preparedStreamingWebm = await prepareSafeAudio(streamingWebm, {
    declaredMime: "audio/webm",
    originalFilename: "media-recorder.webm",
    ffmpegPath,
    ffprobePath,
  });
  assert.ok(
    preparedStreamingWebm.durationMs >= 900 &&
      preparedStreamingWebm.durationMs <= 1100,
  );
  await expectCode(
    prepareSafeAudio(webm, {
      declaredMime: "audio/mp4",
      originalFilename: "voice.m4a",
      ffmpegPath,
      ffprobePath,
    }),
    "audio_declaration_mismatch",
  );
  await expectCode(
    prepareSafeAudio(webm.subarray(0, Math.min(64, webm.length)), {
      declaredMime: "audio/webm",
      originalFilename: "voice.webm",
      ffmpegPath,
      ffprobePath,
    }),
    "audio_processor_failed",
  );

  const videoPath = join(directory, "unexpected-video.webm");
  await execute(ffmpegPath, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=32x32:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libvpx",
    "-c:a",
    "libopus",
    videoPath,
  ]);
  await expectCode(
    prepareSafeAudio(await readFile(videoPath), {
      declaredMime: "audio/webm",
      originalFilename: "unexpected-video.webm",
      ffmpegPath,
      ffprobePath,
    }),
    "unexpected_media_stream",
  );

  await expectCode(
    assertAudioProcessorHealthy({
      ffmpegPath: join(directory, "missing-ffmpeg"),
      ffprobePath,
    }),
    "audio_processor_unavailable",
  );
  console.info(
    "Audio certification passed: processor, WebM/Opus (including unknown-length MediaRecorder output), Ogg/Opus, M4A/AAC, metadata stripping, waveform, mismatch, truncation, unexpected video, unavailable processor.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
