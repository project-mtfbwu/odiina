export type CivilDateParts = {
  year: number;
  month: number;
  day: number;
};

export type CalendarCell = CivilDateParts & {
  date: string;
  inMonth: boolean;
};

export function parseCivilDate(value: string): CivilDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return null;
  }
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidCivilDate(value: string): boolean {
  return parseCivilDate(value) !== null;
}

export function civilDate(parts: CivilDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function fromUtcDate(value: Date): CivilDateParts {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

export function addCivilDays(value: string, days: number): string {
  const parts = parseCivilDate(value);
  if (!parts) throw new Error("invalid_civil_date");
  return civilDate(
    fromUtcDate(
      new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)),
    ),
  );
}

export function monthStart(value: string): string {
  const parts = parseCivilDate(value);
  if (!parts) throw new Error("invalid_civil_date");
  return civilDate({ ...parts, day: 1 });
}

export function addCivilMonthsClamped(value: string, months: number): string {
  const parts = parseCivilDate(value);
  if (!parts) throw new Error("invalid_civil_date");
  const target = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  return civilDate({
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  });
}

export function calendarGrid(
  selectedDate: string,
  weekStartsOn: number,
): CalendarCell[] {
  const first = parseCivilDate(monthStart(selectedDate));
  if (!first || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new Error("invalid_calendar_grid");
  }
  const weekday = new Date(
    Date.UTC(first.year, first.month - 1, 1),
  ).getUTCDay();
  const leadingDays = (weekday - weekStartsOn + 7) % 7;
  const firstCell = addCivilDays(civilDate(first), -leadingDays);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addCivilDays(firstCell, index);
    const parts = parseCivilDate(date)!;
    return {
      ...parts,
      date,
      inMonth: parts.year === first.year && parts.month === first.month,
    };
  });
}

export function formatCivilDate(
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const parts = parseCivilDate(value);
  if (!parts) throw new Error("invalid_civil_date");
  return new Intl.DateTimeFormat("en", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}
