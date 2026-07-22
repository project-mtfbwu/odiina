import { describe, expect, it, vi } from "vitest";

import {
  microphoneFailureMessage,
  normalizedRecorderMimeType,
  recorderMimePriority,
  recordingFilename,
  selectRecorderMimeType,
  stopAudioStream,
} from "@/lib/media/recorder";

describe("voice recorder policy", () => {
  it("selects the first genuinely supported format", () => {
    const supported = vi.fn((mime: string) => mime.includes("ogg"));
    expect(selectRecorderMimeType(supported)).toBe("audio/ogg;codecs=opus");
    expect(supported).toHaveBeenCalledWith(recorderMimePriority[0]);
  });

  it("returns no format for an unsupported recorder", () => {
    expect(selectRecorderMimeType(() => false)).toBeNull();
  });

  it("normalizes browser codec parameters into approved upload declarations", () => {
    expect(normalizedRecorderMimeType("audio/webm;codecs=opus")).toBe(
      "audio/webm",
    );
    expect(normalizedRecorderMimeType("audio/mp4;codecs=mp4a.40.2")).toBe(
      "audio/mp4",
    );
    expect(recordingFilename("audio/ogg", 123)).toBe("odiina-voice-123.ogg");
  });

  it("stops every microphone track", () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    stopAudioStream({
      getTracks: () => [first, second],
    } as unknown as MediaStream);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("distinguishes denied, missing and busy microphone states", () => {
    expect(
      microphoneFailureMessage(new DOMException("denied", "NotAllowedError")),
    ).toContain("denied or dismissed");
    expect(
      microphoneFailureMessage(new DOMException("missing", "NotFoundError")),
    ).toContain("No usable microphone");
    expect(
      microphoneFailureMessage(new DOMException("busy", "NotReadableError")),
    ).toContain("busy or unavailable");
  });
});
