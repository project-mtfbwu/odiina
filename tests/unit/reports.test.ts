import { describe, expect, it } from "vitest";

import { customPeriod, periodForDate } from "@/lib/reports/periods";
import {
  reportCreateSchema,
  reportShareSchema,
  reportUpdateSchema,
} from "@/lib/validation/report";

describe("report civil periods", () => {
  it("keeps daily truth on the selected civil date", () => {
    expect(periodForDate("daily", "2026-07-24")).toMatchObject({
      start: "2026-07-24",
      end: "2026-07-24",
    });
  });

  it("uses the configured Monday week across a month boundary", () => {
    expect(periodForDate("weekly", "2026-08-01", 1)).toMatchObject({
      start: "2026-07-27",
      end: "2026-08-02",
    });
  });

  it("handles leap months and calendar years", () => {
    expect(periodForDate("monthly", "2028-02-29")).toMatchObject({
      start: "2028-02-01",
      end: "2028-02-29",
    });
    expect(periodForDate("yearly", "2028-09-30")).toMatchObject({
      start: "2028-01-01",
      end: "2028-12-31",
    });
  });

  it("bounds custom reports to at most 367 inclusive civil dates", () => {
    expect(customPeriod("2026-01-01", "2027-01-02").end).toBe("2027-01-02");
    expect(() => customPeriod("2026-01-01", "2027-01-03")).toThrow();
  });
});

describe("report request validation", () => {
  it("allows factual creation without any AI field", () => {
    expect(
      reportCreateSchema.parse({
        reportType: "daily",
        start: "2026-07-24",
        end: "2026-07-24",
        title: "A day",
        entryIds: [],
        includePlaces: false,
        clientRequestId: crypto.randomUUID(),
      }),
    ).toBeTruthy();
  });

  it("requires anonymous media sharing to remain disabled", () => {
    const base = {
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      includePlaces: false,
      clientRequestId: crypto.randomUUID(),
    };
    expect(
      reportShareSchema.safeParse({ ...base, includeMedia: false }).success,
    ).toBe(true);
    expect(
      reportShareSchema.safeParse({ ...base, includeMedia: true }).success,
    ).toBe(false);
  });

  it("requires a complete unique accessible section order", () => {
    const order = [
      "cover",
      "at_a_glance",
      "timeline",
      "key_moments",
      "photos",
      "voice",
      "video",
      "places",
      "tags",
      "reflection",
    ];
    const base = {
      title: "Recap",
      introduction: "",
      reflection: "",
      hiddenSections: [],
      selectedEntryIds: [],
      selectedAttachmentIds: [],
      coverAttachmentId: null,
      insightId: null,
    };
    expect(
      reportUpdateSchema.safeParse({ ...base, sectionOrder: order }).success,
    ).toBe(true);
    expect(
      reportUpdateSchema.safeParse({
        ...base,
        sectionOrder: order.map(() => "cover"),
      }).success,
    ).toBe(false);
  });
});
