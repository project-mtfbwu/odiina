import { z } from "zod";

export const placePrecisions = ["label_only", "approximate", "exact"] as const;
export const placeSources = ["manual", "device", "search", "nearby"] as const;
export const implementedPlaceSources = ["manual", "device"] as const;
export const approximateGridDegrees = 0.025;
export const approximateRadiusMeters = 3_000;

const optionalPlaceText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value || null);

export const placeSnapshotSchema = z
  .object({
    placeName: z.string().trim().min(1).max(120),
    placeArea: optionalPlaceText(240),
    placeAddress: optionalPlaceText(240),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable(),
    precision: z.enum(placePrecisions),
    approximateRadiusMeters: z.number().int().nullable(),
    source: z.enum(implementedPlaceSources),
    provider: z.null(),
    providerPlaceId: z.null(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .toUpperCase()
      .nullable()
      .optional()
      .transform((value) => value || null),
    exactConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((place, context) => {
    const hasCoordinates = place.latitude !== null && place.longitude !== null;
    if (place.precision === "label_only") {
      if (hasCoordinates || place.approximateRadiusMeters !== null) {
        context.addIssue({
          code: "custom",
          message: "Label-only places cannot contain coordinates.",
        });
      }
      return;
    }
    if (!hasCoordinates) {
      context.addIssue({
        code: "custom",
        message: "This privacy level requires a selected location.",
      });
      return;
    }
    if (place.precision === "approximate") {
      if (place.approximateRadiusMeters !== approximateRadiusMeters) {
        context.addIssue({
          code: "custom",
          message: "Approximate places must use Odiina's 3 km policy.",
        });
      }
      if (
        !isReducedCoordinate(place.latitude!) ||
        !isReducedCoordinate(place.longitude!)
      ) {
        context.addIssue({
          code: "custom",
          message: "Approximate coordinates must be reduced before saving.",
        });
      }
      return;
    }
    if (place.approximateRadiusMeters !== null || !place.exactConfirmed) {
      context.addIssue({
        code: "custom",
        message: "Confirm before storing an exact private location.",
      });
    }
  });

export type PlaceSnapshotInput = z.infer<typeof placeSnapshotSchema>;

export function reduceCoordinate(value: number): number {
  return Number(
    (
      Math.round(value / approximateGridDegrees) * approximateGridDegrees
    ).toFixed(3),
  );
}

export function isReducedCoordinate(value: number): boolean {
  return Math.abs(reduceCoordinate(value) - value) < 0.000_000_1;
}

export function approximateCoordinates(latitude: number, longitude: number) {
  return {
    latitude: reduceCoordinate(latitude),
    longitude: reduceCoordinate(longitude),
    approximateRadiusMeters,
  };
}
