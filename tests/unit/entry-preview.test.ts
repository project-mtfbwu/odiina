import { describe, expect, it } from "vitest";

import { entryPreview } from "@/components/entry-preview";

describe("Entry preview", () => {
  it("normalizes outer whitespace without interpreting HTML", () => {
    expect(entryPreview("  <script>alert(1)</script>  ")).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("truncates by Unicode code point", () => {
    expect(entryPreview("😀😀😀", 2)).toBe("😀😀…");
  });
});
