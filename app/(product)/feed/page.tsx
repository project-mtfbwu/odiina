import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { EntryComposer } from "@/components/entry-composer";
import { FeedList } from "@/components/feed-list";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { getFeedPage, getPreferences } from "@/lib/database/queries";

export const metadata: Metadata = { title: "Feed" };
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const [preferences, feed, cookieStore] = await Promise.all([
    getPreferences(),
    getFeedPage(null),
    cookies(),
  ]);

  if (!preferences.iana_timezone) {
    redirect("/onboarding");
  }

  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";

  return (
    <div className="content-column">
      <header className="page-header">
        <div>
          <p className="eyebrow">Raw feed</p>
          <h1 className="page-title">Your day, as it happened.</h1>
          <p className="page-description">
            Capture first. Each edit becomes a traceable revision rather than
            replacing what you originally wrote.
          </p>
        </div>
      </header>
      <EntryComposer csrfToken={csrf} timezone={preferences.iana_timezone} />
      <FeedList
        key={`${feed.entries.at(0)?.entry_id ?? "empty"}:${feed.entries.length}:${feed.nextCursor ?? "end"}`}
        initialEntries={feed.entries}
        initialCursor={feed.nextCursor}
        csrfToken={csrf}
      />
    </div>
  );
}
