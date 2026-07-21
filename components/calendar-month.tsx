import Link from "next/link";

import { CalendarIcon, ChevronRightIcon } from "@/components/icons";
import type { CalendarActivity } from "@/lib/database/types";
import {
  addCivilMonthsClamped,
  calendarGrid,
  formatCivilDate,
} from "@/lib/calendar/civil-date";

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function CalendarMonth({
  selectedDate,
  today,
  weekStartsOn,
  activity,
  compact = false,
}: {
  selectedDate: string;
  today: string;
  weekStartsOn: number;
  activity: CalendarActivity[];
  compact?: boolean;
}) {
  const cells = calendarGrid(selectedDate, weekStartsOn);
  const activityByDate = new Map(
    activity.map((item) => [item.occurred_local_date, item.entry_count]),
  );
  const orderedWeekdays = Array.from(
    { length: 7 },
    (_, index) => weekdays[(weekStartsOn + index) % 7],
  );
  const monthLabel = formatCivilDate(selectedDate, {
    month: "long",
    year: "numeric",
  });
  const previousDate = addCivilMonthsClamped(selectedDate, -1);
  const nextDate = addCivilMonthsClamped(selectedDate, 1);
  const calendarHref = (date: string) =>
    `/calendar?date=${date}#calendar-month-heading`;
  const weeks = Array.from({ length: 6 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );

  return (
    <section
      className={compact ? "compact-calendar" : "calendar-month"}
      aria-labelledby={
        compact ? "compact-calendar-heading" : "calendar-month-heading"
      }
    >
      <header className="calendar-toolbar">
        <div>
          {compact ? <p className="eyebrow">Calendar</p> : null}
          <h2
            id={compact ? "compact-calendar-heading" : "calendar-month-heading"}
            tabIndex={-1}
          >
            {monthLabel}
          </h2>
        </div>
        <div className="calendar-controls">
          <Link
            href={calendarHref(previousDate)}
            aria-label={`Previous month, ${formatCivilDate(previousDate, { month: "long", year: "numeric" })}`}
          >
            <ChevronRightIcon className="size-5 rotate-180" />
          </Link>
          {!compact ? (
            <Link className="calendar-today" href={calendarHref(today)}>
              Today
            </Link>
          ) : null}
          <Link
            href={calendarHref(nextDate)}
            aria-label={`Next month, ${formatCivilDate(nextDate, { month: "long", year: "numeric" })}`}
          >
            <ChevronRightIcon className="size-5" />
          </Link>
        </div>
      </header>

      <div className="calendar-grid" role="grid" aria-label={monthLabel}>
        <div className="calendar-weekdays" role="row">
          {orderedWeekdays.map((weekday) => (
            <div role="columnheader" aria-label={weekday} key={weekday}>
              <span aria-hidden="true">
                {weekday.slice(0, compact ? 1 : 3)}
              </span>
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => (
          <div
            className="calendar-week"
            role="row"
            key={week[0]?.date ?? weekIndex}
          >
            {week.map((cell) => {
              const count = activityByDate.get(cell.date) ?? 0;
              const isToday = cell.date === today;
              const isSelected = cell.date === selectedDate;
              const label = [
                formatCivilDate(cell.date, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }),
                isToday ? "today" : "",
                isSelected ? "selected" : "",
                count
                  ? `${count} ${count === 1 ? "Entry" : "Entries"}`
                  : "no Entries",
              ]
                .filter(Boolean)
                .join(", ");
              return (
                <div role="gridcell" key={cell.date}>
                  <Link
                    href={`/calendar?date=${cell.date}#selected-day-heading`}
                    aria-label={label}
                    aria-current={isToday ? "date" : undefined}
                    className="calendar-day"
                    data-in-month={cell.inMonth || undefined}
                    data-selected={isSelected || undefined}
                    data-today={isToday || undefined}
                  >
                    <span className="calendar-day-number">{cell.day}</span>
                    {count ? (
                      <span className="calendar-activity">
                        <span aria-hidden="true" />
                        {compact
                          ? count
                          : `${count} ${count === 1 ? "Entry" : "Entries"}`}
                      </span>
                    ) : null}
                  </Link>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {compact ? (
        <Link
          className="compact-calendar-link"
          href={`/calendar?date=${selectedDate}`}
        >
          <CalendarIcon className="size-4" />
          Open full Calendar
          <ChevronRightIcon className="ml-auto size-4" />
        </Link>
      ) : null}
    </section>
  );
}
