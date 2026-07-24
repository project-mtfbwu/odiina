import {
  addCivilDays,
  civilDate,
  daysInMonth,
  parseCivilDate,
} from "@/lib/calendar/civil-date";

export type ReportType = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export type ReportPeriod = {
  start: string;
  end: string;
  label: string;
};

function weekday(value: string): number {
  const parts = parseCivilDate(value);
  if (!parts) throw new Error("invalid_civil_date");
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function periodForDate(
  type: Exclude<ReportType, "custom">,
  selectedDate: string,
  weekStartsOn = 1,
): ReportPeriod {
  const parts = parseCivilDate(selectedDate);
  if (!parts || weekStartsOn < 0 || weekStartsOn > 6)
    throw new Error("invalid_report_period");
  if (type === "daily") {
    return {
      start: selectedDate,
      end: selectedDate,
      label: `Daily recap · ${selectedDate}`,
    };
  }
  if (type === "weekly") {
    const start = addCivilDays(
      selectedDate,
      -((weekday(selectedDate) - weekStartsOn + 7) % 7),
    );
    const end = addCivilDays(start, 6);
    return { start, end, label: `Weekly recap · ${start} to ${end}` };
  }
  if (type === "monthly") {
    const start = civilDate({ ...parts, day: 1 });
    const end = civilDate({
      ...parts,
      day: daysInMonth(parts.year, parts.month),
    });
    return {
      start,
      end,
      label: `Monthly recap · ${String(parts.month).padStart(2, "0")}/${parts.year}`,
    };
  }
  const start = civilDate({ year: parts.year, month: 1, day: 1 });
  const end = civilDate({ year: parts.year, month: 12, day: 31 });
  return { start, end, label: `Yearly story · ${parts.year}` };
}

export function customPeriod(start: string, end: string): ReportPeriod {
  const first = parseCivilDate(start);
  const last = parseCivilDate(end);
  if (!first || !last || end < start) throw new Error("invalid_report_period");
  const maximum = addCivilDays(start, 366);
  if (end > maximum) throw new Error("invalid_report_period");
  return { start, end, label: `Custom report · ${start} to ${end}` };
}
