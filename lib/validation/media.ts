import { z } from "zod";

import { isOccurrenceConsistent } from "@/lib/validation/timezone";
import { placeSnapshotSchema } from "@/lib/validation/place";

export const acceptedImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const maximumImageBytes = 15 * 1024 * 1024;
export const maximumEntryImages = 5;
export const acceptedAudioMimeTypes = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
] as const;
export const maximumAudioBytes = 25 * 1024 * 1024;
export const minimumAudioDurationMs = 250;
export const maximumAudioDurationMs = 10 * 60 * 1000;
export const acceptedVideoMimeTypes = [
  "video/webm",
  "video/mp4",
  "application/mp4",
  "video/quicktime",
] as const;
export const maximumVideoBytes = 250 * 1024 * 1024;
export const minimumVideoDurationMs = 250;
export const maximumVideoDurationMs = 5 * 60 * 1000;
export const maximumEntryAttachments = maximumEntryImages + 1;

export const authorizeImageSchema = z.object({
  entryId: z.string().uuid().nullable(),
  filename: z.string().trim().min(1).max(180),
  declaredMime: z.enum(acceptedImageMimeTypes),
  byteCount: z.number().int().min(1).max(maximumImageBytes),
});

export const authorizeAudioSchema = z
  .object({
    entryId: z.string().uuid().nullable(),
    filename: z.string().trim().min(1).max(180),
    declaredMime: z.enum(acceptedAudioMimeTypes),
    byteCount: z.number().int().min(1).max(maximumAudioBytes),
  })
  .refine(
    ({ declaredMime, filename }) => {
      const normalized = filename.toLowerCase();
      if (declaredMime === "audio/webm") return normalized.endsWith(".webm");
      if (declaredMime === "audio/ogg") {
        return normalized.endsWith(".ogg") || normalized.endsWith(".oga");
      }
      return normalized.endsWith(".m4a") || normalized.endsWith(".mp4");
    },
    { message: "The audio filename and format do not match." },
  );

export const authorizeVideoSchema = z
  .object({
    entryId: z.string().uuid().nullable(),
    filename: z.string().trim().min(1).max(180),
    declaredMime: z.enum(acceptedVideoMimeTypes),
    byteCount: z.number().int().min(1).max(maximumVideoBytes),
  })
  .refine(
    ({ declaredMime, filename }) => {
      const normalized = filename.toLowerCase();
      if (declaredMime === "video/webm") return normalized.endsWith(".webm");
      if (declaredMime === "video/quicktime")
        return normalized.endsWith(".mov");
      return normalized.endsWith(".mp4") || normalized.endsWith(".m4v");
    },
    { message: "The video filename and format do not match." },
  );

export const attachmentCommandSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentStatusSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).min(1).max(maximumEntryAttachments),
});

export const activateMediaEntrySchema = z
  .object({
    clientRequestId: z.string().uuid(),
    entryId: z.string().uuid(),
    bodyText: z.string().max(100_000),
    attachmentIds: z
      .array(z.string().uuid())
      .max(maximumEntryAttachments)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Duplicate attachments are not allowed.",
      }),
    occurredAt: z.string().datetime({ offset: true }),
    occurredTimezone: z.string().trim().min(1).max(255),
    occurredLocalDate: z.string().date(),
    occurredUtcOffsetMinutes: z.number().int().min(-840).max(840),
    place: placeSnapshotSchema.optional(),
  })
  .refine(isOccurrenceConsistent, {
    message: "Choose a valid occurrence date and time.",
  });
