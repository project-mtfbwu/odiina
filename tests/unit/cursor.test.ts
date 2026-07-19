import { describe, expect, it } from "vitest";

import { decodeFeedCursor, encodeFeedCursor } from "@/lib/database/cursor";

describe("Feed cursor", () => {
  const cursor = {
    occurredAt: "2026-07-19T04:00:00.000Z",
    entryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };

  it("round-trips an opaque cursor", () => {
    expect(decodeFeedCursor(encodeFeedCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "not-base64", Buffer.from("{}").toString("base64url")])(
    "fails closed for invalid input",
    (value) => {
      expect(decodeFeedCursor(value)).toBeNull();
    },
  );
});
