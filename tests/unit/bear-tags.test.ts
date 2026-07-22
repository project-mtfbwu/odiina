import { describe, expect, it } from "vitest";

import {
  extractInlineHashtags,
  mergeInlineHashtags,
  tagQueryValue,
} from "@/lib/tags/inline-hashtags";
import { buildTagCollectionTree } from "@/lib/tags/collections";

describe("Bear-style inline tags", () => {
  it("recognizes Unicode and nested hashtags without changing authored text", () => {
    const body = "Practised #guitar/தாளம் then logged #வேலை and #हिंदी";
    expect(extractInlineHashtags(body)).toEqual([
      "guitar/தாளம்",
      "வேலை",
      "हिंदी",
    ]);
    expect(body).toContain("#guitar/தாளம்");
  });

  it("rejects email, URL, code, and isolated-hash false positives", () => {
    expect(
      extractInlineHashtags(
        "mail me@example#work.test, visit https://x.test/#route, `#code`, and #",
      ),
    ).toEqual([]);
  });

  it("deduplicates normalized tags and respects the ten-tag limit", () => {
    const selected = Array.from({ length: 9 }, (_, index) => `tag${index}`);
    const result = mergeInlineHashtags(
      "#New #new #ignored",
      selected,
      new Set(["ignored"]),
    );
    expect(result.tags).toHaveLength(10);
    expect(result.tags.at(-1)).toBe("New");
  });

  it("allows an inline association to be ignored without deleting text", () => {
    const result = mergeInlineHashtags(
      "Keep #guitar in my words",
      [],
      new Set(["guitar"]),
    );
    expect(result.tags).toEqual([]);
    expect(result.activeIgnored.has("guitar")).toBe(true);
  });

  it("treats a leading hash as picker syntax rather than catalog content", () => {
    expect(tagQueryValue(" #Work/OAS ")).toBe("Work/OAS");
  });
});

describe("nested tag collection presentation", () => {
  it("builds parent and child nodes", () => {
    const tree = buildTagCollectionTree([
      {
        display_name: "Work",
        normalized_name: "work",
        depth: 1,
        direct_entry_count: 1,
        collection_entry_count: 3,
        is_explicit: true,
        has_children: true,
      },
      {
        display_name: "Work/OAS",
        normalized_name: "work/oas",
        depth: 2,
        direct_entry_count: 2,
        collection_entry_count: 2,
        is_explicit: true,
        has_children: false,
      },
    ]);
    expect(tree[0]?.label).toBe("Work");
    expect(tree[0]?.children[0]?.label).toBe("OAS");
  });
});
