import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EntryComposer } from "@/components/entry-composer";
import { FeedContextRail } from "@/components/feed-context-rail";
import { FeedList } from "@/components/feed-list";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { requireVerifiedUser } from "@/lib/auth/user";
import {
  getCalendarMonthActivity,
  getFeedPage,
  getPreferences,
} from "@/lib/database/queries";
import { localCivilDate } from "@/lib/validation/timezone";

export const metadata: Metadata = { title: "Feed" };
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const [preferences, feed, cookieStore, user] = await Promise.all([
    getPreferences(),
    getFeedPage(null),
    cookies(),
    requireVerifiedUser(),
  ]);

  if (!preferences.iana_timezone) {
    redirect("/onboarding");
  }

  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";
  const todayLocal = localCivilDate(new Date(), preferences.iana_timezone);
  const activity = await getCalendarMonthActivity(todayLocal);

  return (
    <div className="feed-workspace">
      <div className="feed-center">
        <header className="page-header feed-header">
          <div>
            <p className="eyebrow">Private raw-life feed</p>
            <h1 className="page-title">Your day, as it happened.</h1>
            <p className="page-description">
              Capture the real version now. Odiina keeps the moment, its media,
              and every later revision traceable.
            </p>
          </div>
        </header>
        <FeedList
          key={`${feed.entries.at(0)?.entry_id ?? "empty"}:${feed.entries.length}:${feed.nextCursor ?? "end"}`}
          initialEntries={feed.entries}
          initialCursor={feed.nextCursor}
          csrfToken={csrf}
          displayName={user.displayName}
          todayLocal={todayLocal}
        />
        <EntryComposer csrfToken={csrf} timezone={preferences.iana_timezone} />
      </div>
      <FeedContextRail
        activity={activity}
        selectedDate={todayLocal}
        today={todayLocal}
        weekStartsOn={preferences.week_starts_on}
        timezone={preferences.iana_timezone}
      />
    </div>
  );
}
