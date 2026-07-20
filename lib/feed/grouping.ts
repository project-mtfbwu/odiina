import type { FeedEntry } from "@/lib/database/types";

export type FeedDayGroup = {
  localDate: string;
  label: string;
  fullDate: string;
  entries: FeedEntry[];
};

function shiftDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function dayLabel(localDate: string, todayLocal: string): string {
  if (localDate === todayLocal) return "Today";
  if (localDate === shiftDate(todayLocal, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

export function groupFeedEntries(
  entries: FeedEntry[],
  todayLocal: string,
): FeedDayGroup[] {
  const grouped = new Map<string, FeedEntry[]>();
  for (const entry of entries) {
    const current = grouped.get(entry.occurred_local_date) ?? [];
    current.push(entry);
    grouped.set(entry.occurred_local_date, current);
  }

  return Array.from(grouped, ([localDate, dayEntries]) => ({
    localDate,
    label: dayLabel(localDate, todayLocal),
    fullDate: new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(`${localDate}T12:00:00Z`)),
    entries: dayEntries,
  }));
}
