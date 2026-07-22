import { describe, expect, it } from "vitest";

import {
  decodeSearchCursor,
  encodeSearchCursor,
  parseSearchParameters,
  searchParametersToQuery,
  searchScope,
} from "@/lib/search/parameters";
import { createEntrySchema } from "@/lib/validation/entry";
import {
  normalizeTagComparison,
  normalizeTagDisplay,
  tagLabelSchema,
  tagListSchema,
} from "@/lib/validation/tag";

describe("private tag normalization", () => {
  it("applies NFKC, trims, collapses whitespace and preserves clean display case", () => {
    expect(normalizeTagDisplay("  ＦＩＬＭ\u3000  IDEAS ")).toBe("FILM IDEAS");
    expect(normalizeTagComparison("  Ｗｏｒｋ ")).toBe("work");
  });

  it("keeps international and emoji-only labels", () => {
    expect(tagLabelSchema.parse("日本語")).toBe("日本語");
    expect(tagLabelSchema.parse("🎸")).toBe("🎸");
  });

  it("rejects controls, empty labels and labels over 40 code points", () => {
    expect(tagLabelSchema.safeParse("bad\u0007tag").success).toBe(false);
    expect(tagLabelSchema.safeParse("  ").success).toBe(false);
    expect(tagLabelSchema.safeParse("x".repeat(41)).success).toBe(false);
  });

  it("rejects normalized duplicates and an eleventh tag", () => {
    expect(tagListSchema.safeParse(["Work", " ｗｏｒｋ "]).success).toBe(false);
    expect(
      tagListSchema.safeParse(
        Array.from({ length: 11 }, (_, index) => `${index}`),
      ).success,
    ).toBe(false);
  });

  it("does not let tags alone satisfy Entry content validation", () => {
    expect(
      createEntrySchema.safeParse({
        clientRequestId: "11111111-1111-4111-8111-111111111111",
        bodyText: "",
        tags: ["Work"],
        occurredAt: "2026-07-22T07:30:00.000Z",
        occurredTimezone: "Asia/Kolkata",
        occurredLocalDate: "2026-07-22",
        occurredUtcOffsetMinutes: 330,
      }).success,
    ).toBe(false);
  });
});

describe("restorable private search parameters", () => {
  it("parses bounded filters and preserves multiple-tag AND state", () => {
    const parameters = parseSearchParameters({
      q: "guitar",
      from: "2026-07-01",
      to: "2026-07-31",
      tag: ["Practice", "Metallica"],
      media: ["audio", "place"],
      hasPlace: "1",
      includeTrash: "1",
      sort: "relevance",
    });
    expect(parameters).toMatchObject({
      invalid: false,
      tags: ["Practice", "Metallica"],
      media: ["audio", "place"],
      hasPlace: true,
      includeTrash: true,
    });
    expect(searchParametersToQuery(parameters).getAll("tag")).toEqual([
      "Practice",
      "Metallica",
    ]);
  });

  it("rejects short queries, impossible ranges and unsupported filters", () => {
    expect(parseSearchParameters({ q: "x" }).invalid).toBe(true);
    expect(
      parseSearchParameters({ from: "2026-08-01", to: "2026-07-01" }).invalid,
    ).toBe(true);
    expect(parseSearchParameters({ media: "transcript" }).invalid).toBe(true);
  });

  it("uses relevance for text and newest for filter-only recall", () => {
    expect(parseSearchParameters({ q: "work" }).sort).toBe("relevance");
    expect(parseSearchParameters({ tag: "Work" }).sort).toBe("newest");
  });

  it("preserves explicit parent collection scope in bookmarkable URLs", () => {
    const parameters = parseSearchParameters({
      tag: "Work",
      tagScope: "collection",
    });
    expect(parameters.tagScope).toBe("collection");
    expect(searchParametersToQuery(parameters).get("tagScope")).toBe(
      "collection",
    );
    expect(parseSearchParameters({ tagScope: "unknown" }).invalid).toBe(true);
  });

  it("binds cursors to the exact query and filter state", () => {
    const parameters = parseSearchParameters({ q: "guitar", tag: "Practice" });
    const scope = searchScope(parameters);
    const cursor = encodeSearchCursor({
      scope,
      rank: 4.25,
      occurredAt: "2026-07-22T07:30:00.000Z",
      entryId: "11111111-1111-4111-8111-111111111111",
    });
    expect(decodeSearchCursor(cursor, scope)?.rank).toBe(4.25);
    expect(
      decodeSearchCursor(cursor, searchScope({ ...parameters, tags: [] })),
    ).toBe(null);
    expect(decodeSearchCursor("not-a-cursor", scope)).toBe(null);
  });
});
