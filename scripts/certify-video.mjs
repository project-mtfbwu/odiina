import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareSafeVideo } from "./media/video-safety.mjs";

const ffmpegPath = process.env.ODIINA_FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.ODIINA_FFPROBE_PATH ?? "ffprobe";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `fixture_generation_failed:${Buffer.concat(stderr).toString("utf8").slice(-500)}`,
            ),
          ),
    );
  });
}

const directory = await mkdtemp(join(tmpdir(), "odiina-video-cert-"));
const fixtures = [
  {
    name: "webm-vp8-opus",
    filename: "synthetic.webm",
    mime: "video/webm",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1.5",
      "-c:v",
      "libvpx",
      "-b:v",
      "700k",
      "-c:a",
      "libopus",
    ],
  },
  {
    name: "mp4-h264-aac-portrait",
    filename: "synthetic.mp4",
    mime: "video/mp4",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=360x640:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=48000",
      "-t",
      "1.5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-metadata",
      "location=+12.34+56.78/",
    ],
  },
  {
    name: "webm-vp9-opus",
    filename: "synthetic-vp9.webm",
    mime: "video/webm",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=480x270:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=550:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "500k",
      "-c:a",
      "libopus",
    ],
  },
  {
    name: "mp4-h264-silent",
    filename: "silent.mp4",
    mime: "video/mp4",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x240:rate=15",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
    ],
  },
  {
    name: "mov-h264-aac",
    filename: "synthetic.mov",
    mime: "video/quicktime",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30000/1001",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=44100",
      "-t",
      "1.25",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
    ],
  },
  {
    name: "mov-hevc-aac",
    filename: "synthetic-hevc.mov",
    mime: "video/quicktime",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=990:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx265",
      "-x265-params",
      "pools=1:frame-threads=1:log-level=error",
      "-tag:v",
      "hvc1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
    ],
  },
];

let passed = 0;
try {
  for (const fixture of fixtures) {
    const path = join(directory, fixture.filename);
    await run([
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...fixture.args,
      path,
    ]);
    const prepared = await prepareSafeVideo(await readFile(path), {
      declaredMime: fixture.mime,
      originalFilename: fixture.filename,
      ffmpegPath,
      ffprobePath,
    });
    if (
      !prepared.playback.length ||
      !prepared.poster.length ||
      prepared.playbackFrameRate > 30
    ) {
      throw new Error(`certification_assertion_failed:${fixture.name}`);
    }
    if (
      fixture.name.includes("portrait") &&
      prepared.playbackHeight <= prepared.playbackWidth
    ) {
      throw new Error("portrait_orientation_not_preserved");
    }
    if (fixture.name.includes("silent") && prepared.hasAudio) {
      throw new Error("silent_video_gained_audio");
    }
    if (
      fixture.name.includes("silent") &&
      (prepared.playbackWidth > 320 || prepared.playbackHeight > 240)
    ) {
      throw new Error("small_video_was_upscaled");
    }
    passed += 1;
    console.info("video_fixture_passed", { fixture: fixture.name });
  }
  const invalid = Buffer.from("not-a-video-fixture");
  await prepareSafeVideo(invalid, {
    declaredMime: "video/mp4",
    originalFilename: "invalid.mp4",
    ffmpegPath,
    ffprobePath,
  }).then(
    () => {
      throw new Error("invalid_signature_accepted");
    },
    (error) => {
      if (error.message !== "unsupported_video_signature") throw error;
    },
  );
  passed += 1;
  console.info("video_fixture_passed", {
    fixture: "unsupported-signature-rejection",
  });
  console.info("video_certification_complete", {
    passed,
    failed: 0,
    skipped: 0,
    fixtures: "synthetic",
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
