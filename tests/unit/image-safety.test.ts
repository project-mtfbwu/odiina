import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  detectImageSignature,
  prepareSafeImage,
  sha256,
} from "../../scripts/media/image-safety.mjs";

async function geometric(format: "jpeg" | "png" | "webp") {
  const image = sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 28, g: 87, b: 214 },
    },
  }).composite([
    {
      input: Buffer.from(
        '<svg width="640" height="360"><rect x="80" y="60" width="210" height="170" fill="#f7c948"/></svg>',
      ),
    },
  ]);
  return image[format]().withMetadata({ orientation: 6 }).toBuffer();
}

describe("private image safety pipeline", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "accepts a decoded geometric %s and produces stripped JPEG derivatives",
    async (format) => {
      const input = await geometric(format);
      expect(detectImageSignature(input)).toBe(format);
      const result = await prepareSafeImage(input);
      expect(result.format).toBe(format);
      expect(result.inputWidth * result.inputHeight).toBeLessThanOrEqual(
        40_000_000,
      );
      for (const derivative of [result.display.data, result.ai.data]) {
        const metadata = await sharp(derivative).metadata();
        expect(metadata.format).toBe("jpeg");
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
      }
      expect(sha256(result.display.data)).not.toEqual(sha256(input));
    },
  );

  it("rejects renamed, unsupported, and truncated data by signature", () => {
    expect(() =>
      detectImageSignature(Buffer.from("<svg>not an image</svg>")),
    ).toThrow("unsupported_signature");
    expect(() => detectImageSignature(Buffer.from("GIF89a"))).toThrow(
      "unsupported_signature",
    );
    expect(() => detectImageSignature(Buffer.from([0xff, 0xd8]))).toThrow(
      "unsupported_signature",
    );
  });

  it("rejects dimensions above the explicit edge limit", async () => {
    const oversizedHeader = await sharp({
      create: {
        width: 12_001,
        height: 1,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();
    await expect(prepareSafeImage(oversizedHeader)).rejects.toThrow(
      "image_dimensions_invalid",
    );
  });

  it("creates purpose-specific avatar and banner display geometry", async () => {
    const input = await geometric("png");
    const avatar = await prepareSafeImage(input, "profile_avatar");
    const banner = await prepareSafeImage(input, "profile_banner");
    expect(avatar.display.info).toMatchObject({ width: 640, height: 640 });
    expect(banner.display.info).toMatchObject({ width: 1600, height: 533 });
  });
});
