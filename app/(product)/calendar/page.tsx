import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CalendarMonth } from "@/components/calendar-month";
import { EntryCard } from "@/components/entry-card";
import { EntryComposer } from "@/components/entry-composer";
import { FragmentFocusRestorer } from "@/components/fragment-focus-restorer";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { requireVerifiedUser } from "@/lib/auth/user";
import {
  getCalendarDayPage,
  getCalendarMonthActivity,
  getPreferences,
} from "@/lib/database/queries";
import { formatCivilDate, isValidCivilDate } from "@/lib/calendar/civil-date";
import { localCivilDate } from "@/lib/validation/timezone";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const user = await requireVerifiedUser();
  const preferences = await getPreferences();
  if (!preferences.iana_timezone) redirect("/onboarding");
  const today = localCivilDate(new Date(), preferences.iana_timezone);
  const selectedDate = params.date ?? today;

  if (!isValidCivilDate(selectedDate)) {
    return (
      <div className="content-column">
        <section className="panel status-card" role="alert">
          <h1 className="page-title">That Calendar date is not valid</h1>
          <p>Calendar dates must use a real civil date in YYYY-MM-DD form.</p>
          <Link
            className="button button-primary mt-4"
            href={`/calendar?date=${today}`}
          >
            Open today
          </Link>
        </section>
      </div>
    );
  }

  const [activity, dayPage, cookieStore] = await Promise.all([
    getCalendarMonthActivity(selectedDate),
    getCalendarDayPage(selectedDate, params.cursor ?? null),
    cookies(),
  ]);
  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";
  const selectedLabel = formatCivilDate(selectedDate, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="calendar-page">
      <FragmentFocusRestorer />
      <header className="page-header">
        <div>
          <p className="eyebrow">Recall by occurrence</p>
          <h1 className="page-title">Calendar</h1>
          <p className="page-description">
            Find Entries by when they happened. Recording and revision times
            remain separate, truthful evidence.
          </p>
        </div>
      </header>

      <CalendarMonth
        selectedDate={selectedDate}
        today={today}
        weekStartsOn={preferences.week_starts_on}
        activity={activity}
      />

      <section
        className="selected-day"
        aria-labelledby="selected-day-heading"
        aria-live="polite"
      >
        <header className="selected-day-header">
          <div>
            <p className="eyebrow">Selected day</p>
            <h2 id="selected-day-heading" tabIndex={-1}>
              {selectedLabel}
            </h2>
          </div>
          <a className="button button-primary" href="#capture-heading">
            Log something for this day
          </a>
        </header>

        {dayPage.entries.length ? (
          <div className="day-entries">
            {dayPage.entries.map((entry) => (
              <EntryCard
                key={entry.entry_id}
                entry={entry}
                displayName={user.displayName}
                csrfToken={csrf}
              />
            ))}
          </div>
        ) : (
          <div className="panel status-card">
            <h3>No Entries happened on this day</h3>
            <p>
              You can record something now while keeping its actual creation
              time truthful.
            </p>
          </div>
        )}
        {dayPage.nextCursor ? (
          <Link
            className="button button-secondary mt-4"
            href={`/calendar?date=${selectedDate}&cursor=${encodeURIComponent(dayPage.nextCursor)}#selected-day-heading`}
          >
            Load more from this day
          </Link>
        ) : null}
      </section>

      <EntryComposer
        csrfToken={csrf}
        timezone={preferences.iana_timezone}
        initialOccurrenceDate={selectedDate}
        inline
      />
    </div>
  );
}
