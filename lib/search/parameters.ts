import { createHash } from "node:crypto";

import { z } from "zod";

import { isValidCivilDate } from "@/lib/calendar/civil-date";
import { normalizeTagDisplay } from "@/lib/validation/tag";

export const searchMediaValues = [
  "text",
  "image",
  "audio",
  "video",
  "place",
] as const;
export const searchSortValues = ["relevance", "newest", "oldest"] as const;

const cursorSchema = z.object({
  scope: z.string().regex(/^[a-f0-9]{16}$/),
  rank: z.number().finite().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
  entryId: z.uuid(),
});

export type SearchSort = (typeof searchSortValues)[number];
export type SearchMedia = (typeof searchMediaValues)[number];

export type SearchParameters = {
  query: string;
  from: string | null;
  to: string | null;
  tags: string[];
  tagScope: "exact" | "collection";
  media: SearchMedia[];
  hasPlace: boolean;
  includeTrash: boolean;
  sort: SearchSort;
  cursor: string | null;
  invalid: boolean;
};

function many(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

export function parseSearchParameters(
  raw: Record<string, string | string[] | undefined>,
): SearchParameters {
  let invalid = false;
  const query = typeof raw.q === "string" ? raw.q.trim() : "";
  if (query.length > 200 || (query.length > 0 && query.length < 2)) {
    invalid = true;
  }
  const from = typeof raw.from === "string" ? raw.from : null;
  const to = typeof raw.to === "string" ? raw.to : null;
  if ((from && !isValidCivilDate(from)) || (to && !isValidCivilDate(to))) {
    invalid = true;
  }
  if (from && to && from > to) invalid = true;

  const tags: string[] = [];
  const normalizedTags = new Set<string>();
  for (const rawTag of many(raw.tag)) {
    try {
      const tag = normalizeTagDisplay(rawTag);
      const normalized = tag.toLocaleLowerCase("und");
      if (
        !tag ||
        Array.from(tag).length > 40 ||
        normalizedTags.has(normalized)
      ) {
        invalid = true;
        continue;
      }
      normalizedTags.add(normalized);
      tags.push(tag);
    } catch {
      invalid = true;
    }
  }
  if (tags.length > 10) invalid = true;
  const tagScope = raw.tagScope === "collection" ? "collection" : "exact";
  if (
    raw.tagScope &&
    raw.tagScope !== "collection" &&
    raw.tagScope !== "exact"
  ) {
    invalid = true;
  }

  const media = many(raw.media).filter((value): value is SearchMedia => {
    const valid = searchMediaValues.includes(value as SearchMedia);
    if (!valid) invalid = true;
    return valid;
  });
  const sortValue = typeof raw.sort === "string" ? raw.sort : "";
  const defaultSort = query ? "relevance" : "newest";
  const sort = searchSortValues.includes(sortValue as SearchSort)
    ? (sortValue as SearchSort)
    : defaultSort;
  if (sortValue && sortValue !== sort) invalid = true;

  return {
    query,
    from,
    to,
    tags: tags.slice(0, 10),
    tagScope,
    media: [...new Set(media)].slice(0, 5),
    hasPlace: raw.hasPlace === "1",
    includeTrash: raw.includeTrash === "1",
    sort,
    cursor: typeof raw.cursor === "string" ? raw.cursor : null,
    invalid,
  };
}

export function searchScope(parameters: SearchParameters): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        q: parameters.query.normalize("NFKC"),
        from: parameters.from,
        to: parameters.to,
        tags: parameters.tags.map((tag) => tag.toLocaleLowerCase("und")).sort(),
        tagScope: parameters.tagScope,
        media: [...parameters.media].sort(),
        hasPlace: parameters.hasPlace,
        includeTrash: parameters.includeTrash,
        sort: parameters.sort,
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

export function encodeSearchCursor(input: {
  scope: string;
  rank: number | null;
  occurredAt: string;
  entryId: string;
}): string {
  return Buffer.from(
    JSON.stringify(cursorSchema.parse(input)),
    "utf8",
  ).toString("base64url");
}

export function decodeSearchCursor(
  value: string | null,
  expectedScope: string,
): z.infer<typeof cursorSchema> | null {
  if (!value) return null;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.scope === expectedScope ? parsed : null;
  } catch {
    return null;
  }
}

export function searchParametersToQuery(
  parameters: SearchParameters,
  cursor?: string | null,
): URLSearchParams {
  const result = new URLSearchParams();
  if (parameters.query) result.set("q", parameters.query);
  if (parameters.from) result.set("from", parameters.from);
  if (parameters.to) result.set("to", parameters.to);
  for (const tag of parameters.tags) result.append("tag", tag);
  if (parameters.tagScope === "collection") {
    result.set("tagScope", "collection");
  }
  for (const media of parameters.media) result.append("media", media);
  if (parameters.hasPlace) result.set("hasPlace", "1");
  if (parameters.includeTrash) result.set("includeTrash", "1");
  result.set("sort", parameters.sort);
  if (cursor) result.set("cursor", cursor);
  return result;
}
