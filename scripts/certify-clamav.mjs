import sharp from "sharp";

import { assertScannerHealthy, scanBuffer } from "./media/clamav.mjs";

const scanner = {
  host: process.env.ODIINA_CLAMAV_HOST ?? "127.0.0.1",
  port: Number(process.env.ODIINA_CLAMAV_PORT ?? "3310"),
  timeoutMs: 10_000,
};

await assertScannerHealthy(scanner);
const geometric = await sharp({
  create: {
    width: 32,
    height: 32,
    channels: 3,
    background: { r: 20, g: 80, b: 210 },
  },
})
  .png()
  .toBuffer();
const clean = await scanBuffer(geometric, scanner);
if (!clean.clean) throw new Error("generated_image_not_clean");

const eicar = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);
const detected = await scanBuffer(eicar, scanner);
if (detected.clean) throw new Error("eicar_not_detected");

let unavailableFailedClosed = false;
try {
  await assertScannerHealthy({ ...scanner, port: scanner.port + 1 });
} catch {
  unavailableFailedClosed = true;
}
if (!unavailableFailedClosed) throw new Error("scanner_unavailable_not_closed");

console.info("ClamAV certification passed: health, clean, EICAR, unavailable.");
