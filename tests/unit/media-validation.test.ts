import { describe, expect, it } from "vitest";

import {
  activateMediaEntrySchema,
  authorizeAudioSchema,
  authorizeImageSchema,
  maximumAudioBytes,
  maximumImageBytes,
} from "@/lib/validation/media";

describe("media command validation", () => {
  it("accepts only the private-beta image MIME allowlist and byte limit", () => {
    const base = {
      entryId: null,
      filename: "geometry.png",
      declaredMime: "image/png",
      byteCount: maximumImageBytes,
    };
    expect(authorizeImageSchema.safeParse(base).success).toBe(true);
    expect(
      authorizeImageSchema.safeParse({
        ...base,
        declaredMime: "image/svg+xml",
      }).success,
    ).toBe(false);
    expect(
      authorizeImageSchema.safeParse({
        ...base,
        byteCount: maximumImageBytes + 1,
      }).success,
    ).toBe(false);
  });

  it("accepts only the narrow audio declaration, extension and byte policy", () => {
    const base = {
      entryId: null,
      filename: "voice.webm",
      declaredMime: "audio/webm",
      byteCount: maximumAudioBytes,
    };
    expect(authorizeAudioSchema.safeParse(base).success).toBe(true);
    expect(
      authorizeAudioSchema.safeParse({ ...base, filename: "voice.m4a" })
        .success,
    ).toBe(false);
    expect(
      authorizeAudioSchema.safeParse({ ...base, declaredMime: "audio/mpeg" })
        .success,
    ).toBe(false);
    expect(
      authorizeAudioSchema.safeParse({
        ...base,
        byteCount: maximumAudioBytes + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate or more than six mixed attachment memberships", () => {
    const base = {
      clientRequestId: "00000000-0000-4000-8000-000000000099",
      entryId: "00000000-0000-4000-8000-000000000001",
      bodyText: "",
      occurredAt: "2026-07-20T10:00:00.000Z",
      occurredTimezone: "UTC",
      occurredLocalDate: "2026-07-20",
      occurredUtcOffsetMinutes: 0,
    };
    const id = "00000000-0000-4000-8000-000000000002";
    expect(
      activateMediaEntrySchema.safeParse({
        ...base,
        attachmentIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      activateMediaEntrySchema.safeParse({
        ...base,
        attachmentIds: Array.from(
          { length: 7 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });
});
