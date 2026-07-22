import { describe, expect, it } from "vitest";

import {
  detectVideoFamily,
  durationFromVideoPacketCsv,
  fractionValue,
  validateVideoDeclaration,
} from "../../scripts/media/video-safety.mjs";

describe("video safety declarations", () => {
  it("recognizes only WebM and ISO-BMFF signatures", () => {
    expect(
      detectVideoFamily(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(8).fill(0)]),
      ),
    ).toBe("webm");
    expect(detectVideoFamily(Buffer.from("0000ftypisom"))).toBe("iso_bmff");
    expect(() => detectVideoFamily(Buffer.from("RIFF-not-video"))).toThrow(
      "unsupported_video_signature",
    );
  });

  it("requires signature, MIME and extension agreement", () => {
    expect(
      validateVideoDeclaration({
        family: "webm",
        declaredMime: "video/webm",
        originalFilename: "capture.webm",
      }),
    ).toBe("webm");
    expect(
      validateVideoDeclaration({
        family: "iso_bmff",
        declaredMime: "video/quicktime",
        originalFilename: "capture.mov",
      }),
    ).toBe("mov");
    expect(() =>
      validateVideoDeclaration({
        family: "webm",
        declaredMime: "video/mp4",
        originalFilename: "capture.mp4",
      }),
    ).toThrow("video_declaration_mismatch");
  });

  it("parses rational frame rates and unknown-duration packet timelines", () => {
    expect(fractionValue("30000/1001")).toBeCloseTo(29.97, 2);
    expect(
      durationFromVideoPacketCsv("0.000000,0.033000\n1.967000,0.033000\n"),
    ).toBe(2);
  });
});
