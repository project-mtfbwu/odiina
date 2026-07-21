import { describe, expect, it } from "vitest";

import {
  addCivilDays,
  addCivilMonthsClamped,
  calendarGrid,
  isValidCivilDate,
} from "@/lib/calendar/civil-date";

describe("civil Calendar dates", () => {
  it.each([
    ["2024-02-29", true],
    ["2026-02-29", false],
    ["2026-04-31", false],
    ["2026-12-31", true],
    ["2026-7-01", false],
  ])("validates %s", (value, expected) => {
    expect(isValidCivilDate(value)).toBe(expected);
  });

  it("clamps month navigation rather than creating 31 February", () => {
    expect(addCivilMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCivilMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("crosses month and year ends without local Date parsing", () => {
    expect(addCivilDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCivilDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("builds a stable six-week grid from the configured week start", () => {
    const grid = calendarGrid("2026-07-20", 1);
    expect(grid).toHaveLength(42);
    expect(grid[0].date).toBe("2026-06-29");
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
  });
});
