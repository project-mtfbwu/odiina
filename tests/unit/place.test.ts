import { describe, expect, it, vi } from "vitest";

import { getOneTimePosition } from "@/lib/place/geolocation";
import {
  approximateCoordinates,
  approximateGridDegrees,
  isReducedCoordinate,
  placeSnapshotSchema,
  reduceCoordinate,
} from "@/lib/validation/place";

const labelOnly = {
  placeName: "Café 日本語 🧭",
  placeArea: "Central district",
  placeAddress: null,
  latitude: null,
  longitude: null,
  precision: "label_only" as const,
  approximateRadiusMeters: null,
  source: "manual" as const,
  provider: null,
  providerPlaceId: null,
  countryCode: null,
};

describe("place validation and coordinate privacy", () => {
  it("accepts Unicode manual labels and trims their boundaries", () => {
    expect(
      placeSnapshotSchema.parse({
        ...labelOnly,
        placeName: "  Café 日本語 🧭  ",
      }).placeName,
    ).toBe("Café 日本語 🧭");
  });

  it("enforces label length and never permits coordinates in label-only mode", () => {
    expect(
      placeSnapshotSchema.safeParse({
        ...labelOnly,
        placeName: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      placeSnapshotSchema.safeParse({
        ...labelOnly,
        latitude: 12,
        longitude: 77,
      }).success,
    ).toBe(false);
  });

  it("rejects unimplemented provider sources and identifiers", () => {
    expect(
      placeSnapshotSchema.safeParse({ ...labelOnly, source: "nearby" }).success,
    ).toBe(false);
    expect(
      placeSnapshotSchema.safeParse({ ...labelOnly, provider: "unapproved" })
        .success,
    ).toBe(false);
  });

  it("reduces approximate coordinates locally to the documented grid", () => {
    const reduced = approximateCoordinates(12.9716, 77.5946);
    expect(reduced).toEqual({
      latitude: 12.975,
      longitude: 77.6,
      approximateRadiusMeters: 3_000,
    });
    expect(isReducedCoordinate(reduced.latitude)).toBe(true);
    expect(reduceCoordinate(approximateGridDegrees)).toBe(0.025);
  });

  it("rejects unquantized approximate coordinates and unconfirmed exact ones", () => {
    expect(
      placeSnapshotSchema.safeParse({
        ...labelOnly,
        latitude: 12.9716,
        longitude: 77.5946,
        precision: "approximate",
        approximateRadiusMeters: 3_000,
        source: "device",
      }).success,
    ).toBe(false);
    expect(
      placeSnapshotSchema.safeParse({
        ...labelOnly,
        latitude: 12.9716,
        longitude: 77.5946,
        precision: "exact",
        source: "device",
        exactConfirmed: false,
      }).success,
    ).toBe(false);
  });

  it("accepts explicitly confirmed exact coordinates", () => {
    expect(
      placeSnapshotSchema.safeParse({
        ...labelOnly,
        latitude: -90,
        longitude: 180,
        precision: "exact",
        source: "device",
        exactConfirmed: true,
      }).success,
    ).toBe(true);
  });
});

describe("one-time browser location", () => {
  it("requests exactly one fresh, non-high-accuracy fix", async () => {
    const getCurrentPosition = vi.fn(
      (
        success: PositionCallback,
        failure?: PositionErrorCallback | null,
        options?: PositionOptions,
      ) => {
        void failure;
        void options;
        success({
          coords: { latitude: 12.97, longitude: 77.59, accuracy: 24 },
        } as GeolocationPosition);
      },
    );
    const result = await getOneTimePosition({
      secure: true,
      geolocation: { getCurrentPosition } as unknown as Geolocation,
      timeoutMs: 4321,
    });
    expect(result).toEqual({
      latitude: 12.97,
      longitude: 77.59,
      accuracyMeters: 24,
    });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 4321,
    });
  });

  it("fails closed without a secure context or geolocation support", async () => {
    await expect(
      getOneTimePosition({ secure: false, geolocation: undefined }),
    ).rejects.toMatchObject({ code: "insecure_context" });
    await expect(
      getOneTimePosition({ secure: true, geolocation: undefined }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it.each([
    [1, "permission_denied"],
    [2, "position_unavailable"],
    [3, "timeout"],
  ] as const)(
    "maps geolocation error %s without leaking detail",
    async (code, expected) => {
      const geolocation = {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback,
        ) =>
          error({
            code,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: "private platform detail",
          }),
      } as Geolocation;
      await expect(
        getOneTimePosition({ secure: true, geolocation }),
      ).rejects.toMatchObject({ code: expected, message: expected });
    },
  );
});
