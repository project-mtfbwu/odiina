import { describe, expect, it, vi } from "vitest";

import {
  formatVideoDuration,
  normalizedVideoMimeType,
  selectVideoRecorderMimeType,
  stopVideoStream,
  videoCaptureCapability,
  videoCaptureFailureMessage,
  videoRecorderMimePriority,
  videoRecordingFilename,
} from "@/lib/media/video-recorder";

describe("video recorder policy", () => {
  it("negotiates the first browser-supported source format", () => {
    const supported = vi.fn((mime: string) => mime.includes("vp8"));
    expect(selectVideoRecorderMimeType(supported)).toBe(
      "video/webm;codecs=vp8,opus",
    );
    expect(supported).toHaveBeenCalledWith(videoRecorderMimePriority[0]);
  });

  it("falls back honestly when no source format is supported", () => {
    expect(selectVideoRecorderMimeType(() => false)).toBeNull();
  });

  it("fails closed outside a secure browser context", () => {
    expect(videoCaptureCapability()).toBe("insecure");
  });

  it("normalizes recorder declarations and creates opaque product filenames", () => {
    expect(normalizedVideoMimeType("video/webm;codecs=vp9,opus")).toBe(
      "video/webm",
    );
    expect(normalizedVideoMimeType("video/mp4;codecs=avc1.42E01E")).toBe(
      "video/mp4",
    );
    expect(videoRecordingFilename("video/mp4", 123)).toBe(
      "odiina-video-123.mp4",
    );
  });

  it("stops every camera and microphone track", () => {
    const video = { stop: vi.fn() };
    const audio = { stop: vi.fn() };
    stopVideoStream({
      getTracks: () => [video, audio],
    } as unknown as MediaStream);
    expect(video.stop).toHaveBeenCalledOnce();
    expect(audio.stop).toHaveBeenCalledOnce();
  });

  it("distinguishes denied, missing and busy camera states", () => {
    expect(
      videoCaptureFailureMessage(new DOMException("denied", "NotAllowedError")),
    ).toContain("denied or dismissed");
    expect(
      videoCaptureFailureMessage(new DOMException("missing", "NotFoundError")),
    ).toContain("No usable camera");
    expect(
      videoCaptureFailureMessage(new DOMException("busy", "NotReadableError")),
    ).toContain("busy or unavailable");
  });

  it("formats bounded elapsed time without noisy live announcements", () => {
    expect(formatVideoDuration(0)).toBe("0:00");
    expect(formatVideoDuration(65_999)).toBe("1:05");
  });
});
