import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { SearchIcon } from "@/components/icons";
import { SearchResults } from "@/components/search-results";
import { StatusCard } from "@/components/status-card";
import { csrfCookieName } from "@/lib/auth/cookie-options";
import { requireVerifiedUser } from "@/lib/auth/user";
import { getSearchPage, getTagSuggestions } from "@/lib/database/queries";
import {
  parseSearchParameters,
  searchMediaValues,
  searchParametersToQuery,
} from "@/lib/search/parameters";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const mediaLabels = {
  text: "Text Entries",
  image: "Photo Entries",
  audio: "Voice Entries",
  video: "Video Entries",
  place: "Place Entries",
} as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const parameters = parseSearchParameters(raw);
  const hasCriteria = Boolean(
    parameters.query ||
    parameters.from ||
    parameters.to ||
    parameters.tags.length ||
    parameters.media.length ||
    parameters.hasPlace ||
    parameters.includeTrash,
  );
  const [user, cookieStore, suggestions] = await Promise.all([
    requireVerifiedUser(),
    cookies(),
    getTagSuggestions("", 20),
  ]);
  const page =
    hasCriteria && !parameters.invalid
      ? await getSearchPage(parameters)
      : { entries: [], nextCursor: null };
  const csrf = cookieStore.get(csrfCookieName)?.value ?? "";
  const suggestionNames = new Set(
    suggestions.map((suggestion) => suggestion.normalized_name),
  );
  const tagOptions = [
    ...suggestions.map((suggestion) => suggestion.display_name),
    ...parameters.tags.filter(
      (tag) => !suggestionNames.has(tag.toLocaleLowerCase("und")),
    ),
  ];

  return (
    <div className="search-workspace">
      <header className="page-header search-header">
        <div>
          <p className="eyebrow">Private recall</p>
          <h1 className="page-title">Search your Odiina</h1>
          <p className="page-description">
            Find current text, confirmed places and your private tags. Media
            filters describe file types—not their contents.
          </p>
        </div>
      </header>

      <form className="search-form" action="/search" method="get" role="search">
        <div className="search-query-row">
          <label className="search-query-field">
            <span>Search private Entries</span>
            <input
              type="search"
              name="q"
              defaultValue={parameters.query}
              maxLength={200}
              aria-describedby="search-query-help"
              placeholder="Guitar practice, Marina Beach, Work…"
            />
          </label>
          <button className="button button-primary" type="submit">
            <SearchIcon className="size-5" /> Search
          </button>
        </div>
        <p id="search-query-help" className="field-help">
          Use at least two characters. Odiina does not send searches to AI,
          analytics or third parties.
        </p>

        <div className="search-filter-grid">
          <fieldset className="search-filter-panel">
            <legend>Occurrence date</legend>
            <label>
              <span>From</span>
              <input
                type="date"
                name="from"
                defaultValue={parameters.from ?? ""}
              />
            </label>
            <label>
              <span>To</span>
              <input type="date" name="to" defaultValue={parameters.to ?? ""} />
            </label>
          </fieldset>

          <fieldset className="search-filter-panel">
            <legend>
              Entry types <span>match any selected</span>
            </legend>
            <div className="search-check-grid">
              {searchMediaValues.map((media) => (
                <label key={media}>
                  <input
                    type="checkbox"
                    name="media"
                    value={media}
                    defaultChecked={parameters.media.includes(media)}
                  />
                  <span>{mediaLabels[media]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="search-filter-panel search-tag-filter">
            <legend>
              Tags <span>match every selected</span>
            </legend>
            {tagOptions.length ? (
              <div className="search-check-grid">
                {tagOptions.map((tag) => (
                  <label key={tag.toLocaleLowerCase("und")}>
                    <input
                      type="checkbox"
                      name="tag"
                      value={tag}
                      defaultChecked={parameters.tags.some(
                        (selected) =>
                          selected.toLocaleLowerCase("und") ===
                          tag.toLocaleLowerCase("und"),
                      )}
                    />
                    <span>{tag}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted-state">No private tags yet.</p>
            )}
          </fieldset>

          <fieldset className="search-filter-panel">
            <legend>Scope</legend>
            <div className="search-check-grid">
              <label>
                <input
                  type="checkbox"
                  name="hasPlace"
                  value="1"
                  defaultChecked={parameters.hasPlace}
                />
                <span>Has a confirmed place</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="includeTrash"
                  value="1"
                  defaultChecked={parameters.includeTrash}
                />
                <span>Include Trash</span>
              </label>
            </div>
            <label className="search-sort-field">
              <span>Sort results</span>
              <select name="sort" defaultValue={parameters.sort}>
                <option value="relevance">Relevance</option>
                <option value="newest">Newest occurrence</option>
                <option value="oldest">Oldest occurrence</option>
              </select>
            </label>
          </fieldset>
        </div>
        <div className="search-form-actions">
          <button className="button button-primary" type="submit">
            Apply filters
          </button>
          <Link className="button button-secondary" href="/search">
            Clear all filters
          </Link>
        </div>
      </form>

      {parameters.invalid ? (
        <StatusCard title="Some search filters are not valid">
          Use a query of 2–200 characters, real occurrence dates, known media
          types and no more than ten tags. Clear the filters to start again.
        </StatusCard>
      ) : !hasCriteria ? (
        <StatusCard title="Recall something private">
          Search words you wrote, a confirmed place, or your own tags. You can
          also browse by media type or occurrence date without entering text.
        </StatusCard>
      ) : page.entries.length === 0 ? (
        <StatusCard
          title="No matching Entries"
          action={
            <Link className="button button-secondary" href="/calendar">
              Browse Calendar
            </Link>
          }
        >
          Check the spelling, remove a filter, broaden the occurrence range or
          try one private tag at a time.
        </StatusCard>
      ) : (
        <SearchResults
          key={searchParametersToQuery(parameters).toString()}
          initialEntries={page.entries}
          csrfToken={csrf}
          displayName={user.displayName}
          includeTrash={parameters.includeTrash}
          nextPageHref={
            page.nextCursor
              ? `/search?${searchParametersToQuery(parameters, page.nextCursor)}`
              : null
          }
        />
      )}
    </div>
  );
}
