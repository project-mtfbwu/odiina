import { describe, expect, it } from "vitest";

import { createEntrySchema, reviseEntrySchema } from "@/lib/validation/entry";

const validOccurrence = {
  occurredAt: "2026-07-19T04:00:00.000Z",
  occurredTimezone: "Asia/Kolkata",
  occurredLocalDate: "2026-07-19",
  occurredUtcOffsetMinutes: 330,
};

describe("Entry validation", () => {
  it("trims and accepts a valid text Entry", () => {
    const parsed = createEntrySchema.parse({
      ...validOccurrence,
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      bodyText: "  a raw note  ",
    });
    expect(parsed.bodyText).toBe("a raw note");
  });

  it.each(["", "   ", "x".repeat(100_001)])(
    "rejects invalid text length",
    (bodyText) => {
      expect(() =>
        createEntrySchema.parse({
          ...validOccurrence,
          clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          bodyText,
        }),
      ).toThrow();
    },
  );

  it("requires the expected revision and a fixed reason", () => {
    expect(() =>
      reviseEntrySchema.parse({
        ...validOccurrence,
        expectedCurrentRevisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        bodyText: "replacement",
        changeReason: "silently_overwrite",
      }),
    ).toThrow();
  });
});
