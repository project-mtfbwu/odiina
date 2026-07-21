import { describe, expect, it } from "vitest";

import {
  normalizeProfileHandle,
  reservedProfileHandles,
  saveProfileSchema,
} from "@/lib/validation/profile";

const validProfile = {
  displayName: "Aarav Rao",
  handle: "aarav_rao",
  bio: "First line\nSecond line",
  avatarAttachmentId: null,
  bannerAttachmentId: null,
};

describe("private Profile validation", () => {
  it("normalizes a handle to its documented lowercase canonical form", () => {
    expect(normalizeProfileHandle("  Aarav_42 ")).toBe("aarav_42");
    expect(saveProfileSchema.parse(validProfile).handle).toBe("aarav_rao");
  });

  it.each([...reservedProfileHandles])(
    "rejects reserved handle %s",
    (handle) => {
      expect(
        saveProfileSchema.safeParse({ ...validProfile, handle }).success,
      ).toBe(false);
    },
  );

  it("accepts Unicode display names without rewriting capitalization", () => {
    const displayName = "  Élodie 李  ";
    expect(
      saveProfileSchema.parse({ ...validProfile, displayName }).displayName,
    ).toBe("Élodie 李");
  });

  it("preserves plain-text bio line breaks and rejects excessive content", () => {
    expect(saveProfileSchema.parse(validProfile).bio).toBe(
      "First line\nSecond line",
    );
    expect(
      saveProfileSchema.safeParse({ ...validProfile, bio: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it.each(["ab", "2fast", "with-dash", "space here", "a".repeat(31)])(
    "rejects invalid handle %s",
    (handle) => {
      expect(
        saveProfileSchema.safeParse({ ...validProfile, handle }).success,
      ).toBe(false);
    },
  );
});
