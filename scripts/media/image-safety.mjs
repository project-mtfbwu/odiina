import { createHash } from "node:crypto";

import sharp from "sharp";

export const limits = {
  bytes: 15 * 1024 * 1024,
  pixels: 40_000_000,
  dimension: 12_000,
};

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest();
}

export function detectImageSignature(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  throw new Error("unsupported_signature");
}

export async function prepareSafeImage(buffer, purpose = "entry") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12)
    throw new Error("image_truncated");
  if (buffer.length > limits.bytes) throw new Error("image_too_large");
  const signature = detectImageSignature(buffer);
  const decoder = sharp(buffer, {
    failOn: "error",
    limitInputPixels: limits.pixels,
    sequentialRead: true,
    unlimited: false,
  });
  const metadata = await decoder.metadata();
  if (
    metadata.format !== signature ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > limits.dimension ||
    metadata.height > limits.dimension ||
    metadata.width * metadata.height > limits.pixels
  ) {
    throw new Error("image_dimensions_invalid");
  }
  if (
    (metadata.pages ?? 1) !== 1 ||
    (metadata.pageHeight ?? metadata.height) !== metadata.height
  ) {
    throw new Error("animated_image_rejected");
  }

  const displayResize =
    purpose === "profile_avatar"
      ? { width: 640, height: 640, fit: "cover", position: "centre" }
      : purpose === "profile_banner"
        ? { width: 1600, height: 533, fit: "cover", position: "centre" }
        : {
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          };
  const display = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: limits.pixels,
    sequentialRead: true,
  })
    .rotate()
    .resize(displayResize)
    .jpeg({ quality: 86, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const ai = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: limits.pixels,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    format: signature,
    inputWidth: metadata.width,
    inputHeight: metadata.height,
    display,
    ai,
  };
}
