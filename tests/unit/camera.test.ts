import { describe, expect, it, vi } from "vitest";

import { cameraFailureMessage, stopMediaStream } from "@/lib/media/camera";

describe("camera lifecycle", () => {
  it("stops every media track", () => {
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    const stream = {
      getTracks: () => [first, second],
    } as unknown as MediaStream;

    stopMediaStream(stream);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("is safe when no stream was acquired", () => {
    expect(() => stopMediaStream(null)).not.toThrow();
  });

  it("gives permission-denied guidance without claiming no device", () => {
    expect(
      cameraFailureMessage(new DOMException("blocked", "NotAllowedError")),
    ).toContain("browser settings");
  });

  it("distinguishes a missing camera device", () => {
    expect(
      cameraFailureMessage(new DOMException("missing", "NotFoundError")),
    ).toContain("No usable camera");
  });
});
