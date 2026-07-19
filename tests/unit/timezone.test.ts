import { describe, expect, it } from "vitest";

import {
  isValidIanaTimezone,
  localCivilDate,
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
});
