export const limits: {
  bytes: number;
  pixels: number;
  dimension: number;
};

export function sha256(buffer: Buffer): Buffer;
export function detectImageSignature(buffer: Buffer): "jpeg" | "png" | "webp";
export function prepareSafeImage(buffer: Buffer): Promise<{
  format: "jpeg" | "png" | "webp";
  inputWidth: number;
  inputHeight: number;
  display: { data: Buffer; info: { width: number; height: number } };
  ai: { data: Buffer; info: { width: number; height: number } };
}>;
