import { describe, expect, it } from "vitest";

import {
  detectAudioContainer,
  durationFromPacketCsv,
  validateAudioDeclaration,
} from "../../scripts/media/audio-safety.mjs";

describe("audio safety declarations", () => {
  it("recognizes only the approved container signatures", () => {
    expect(
      detectAudioContainer(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(8).fill(0)]),
      ),
    ).toBe("webm");
    expect(detectAudioContainer(Buffer.from("OggS00000000"))).toBe("ogg");
    expect(detectAudioContainer(Buffer.from("0000ftypM4A "))).toBe("m4a");
    expect(() => detectAudioContainer(Buffer.from("ID3-not-accepted"))).toThrow(
      "unsupported_audio_signature",
    );
  });

  it("requires MIME, extension and signature agreement", () => {
    expect(() =>
      validateAudioDeclaration({
        container: "webm",
        declaredMime: "audio/webm",
        originalFilename: "voice.webm",
      }),
    ).not.toThrow();
    expect(() =>
      validateAudioDeclaration({
        container: "webm",
        declaredMime: "audio/mp4",
        originalFilename: "voice.m4a",
      }),
    ).toThrow("audio_declaration_mismatch");
  });

  it("derives duration from bounded packet timestamps when containers omit it", () => {
    expect(
      durationFromPacketCsv("0.000000,0.020000\n1.980000,0.020000\n"),
    ).toBe(2);
    expect(durationFromPacketCsv("N/A,N/A\n")).toBeNaN();
  });
});
