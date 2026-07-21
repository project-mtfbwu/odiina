import { describe, expect, it } from "vitest";

import {
  isValidIanaTimezone,
  localCivilDate,
  occurrenceFromLocalDateTime,
  utcOffsetMinutes,
} from "@/lib/validation/timezone";

describe("timezone handling", () => {
  it("validates IANA names", () => {
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidIanaTimezone("Definitely/Not_A_Zone")).toBe(false);
  });

  it("derives the local civil date across UTC midnight", () => {
    const instant = new Date("2026-07-18T20:00:00.000Z");
    expect(localCivilDate(instant, "Asia/Kolkata")).toBe("2026-07-19");
    expect(utcOffsetMinutes(instant, "Asia/Kolkata")).toBe(330);
  });

  it("respects daylight-saving offsets", () => {
    expect(
      utcOffsetMinutes(new Date("2026-01-19T12:00:00Z"), "Europe/London"),
    ).toBe(0);
    expect(
      utcOffsetMinutes(new Date("2026-07-19T12:00:00Z"), "Europe/London"),
    ).toBe(60);
  });

  it("resolves a selected Kolkata civil time without shifting its date", () => {
    expect(
      occurrenceFromLocalDateTime("2026-07-12", "09:15", "Asia/Kolkata"),
    ).toEqual({
      occurredAt: "2026-07-12T03:45:00.000Z",
      occurredLocalDate: "2026-07-12",
      occurredTimezone: "Asia/Kolkata",
      occurredUtcOffsetMinutes: 330,
    });
  });

  it("keeps a near-midnight civil date when its instant is on the prior UTC day", () => {
    expect(
      occurrenceFromLocalDateTime("2027-01-01", "00:05", "Asia/Kolkata"),
    ).toEqual({
      occurredAt: "2026-12-31T18:35:00.000Z",
      occurredLocalDate: "2027-01-01",
      occurredTimezone: "Asia/Kolkata",
      occurredUtcOffsetMinutes: 330,
    });
  });

  it("rejects a wall time skipped by a DST transition", () => {
    expect(() =>
      occurrenceFromLocalDateTime("2026-03-29", "01:30", "Europe/London"),
    ).toThrow("nonexistent_local_time");
  });

  it("chooses the earlier instant when a DST wall time repeats", () => {
    expect(
      occurrenceFromLocalDateTime("2026-10-25", "01:30", "Europe/London")
        .occurredAt,
    ).toBe("2026-10-25T00:30:00.000Z");
  });

  it("rejects invalid timezone and calendar input", () => {
    expect(() =>
      occurrenceFromLocalDateTime("2026-07-20", "12:00", "Not/A_Zone"),
    ).toThrow("invalid_timezone");
    expect(() =>
      occurrenceFromLocalDateTime("2026-02-30", "12:00", "Asia/Kolkata"),
    ).toThrow("invalid_local_datetime");
  });
});
