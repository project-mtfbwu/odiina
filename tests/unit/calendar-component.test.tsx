// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CalendarMonth } from "@/components/calendar-month";

describe("CalendarMonth", () => {
  it("names dates, today, selection and real activity for assistive technology", () => {
    render(
      <CalendarMonth
        selectedDate="2026-07-20"
        today="2026-07-20"
        weekStartsOn={1}
        activity={[
          { occurred_local_date: "2026-07-12", entry_count: 2 },
          { occurred_local_date: "2026-07-20", entry_count: 1 },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "July 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Monday, July 20, 2026, today, selected, 1 Entry",
      }),
    ).toHaveAttribute("aria-current", "date");
    expect(
      screen.getByRole("link", {
        name: "Sunday, July 12, 2026, 2 Entries",
      }),
    ).toHaveAttribute("href", "/calendar?date=2026-07-12#selected-day-heading");
    expect(
      screen.getByRole("link", { name: "Previous month, June 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });
});
