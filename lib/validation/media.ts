import { z } from "zod";

export const acceptedImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const maximumImageBytes = 15 * 1024 * 1024;
export const maximumEntryImages = 5;

export const authorizeImageSchema = z.object({
  entryId: z.string().uuid().nullable(),
  filename: z.string().trim().min(1).max(180),
  declaredMime: z.enum(acceptedImageMimeTypes),
  byteCount: z.number().int().min(1).max(maximumImageBytes),
});

export const attachmentCommandSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentStatusSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).min(1).max(maximumEntryImages),
});

export const activateMediaEntrySchema = z.object({
  entryId: z.string().uuid(),
  bodyText: z.string().max(100_000),
  attachmentIds: z
    .array(z.string().uuid())
    .max(maximumEntryImages)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Duplicate attachments are not allowed.",
    }),
  occurredAt: z.string().datetime({ offset: true }),
  occurredTimezone: z.string().trim().min(1).max(255),
  occurredLocalDate: z.string().date(),
  occurredUtcOffsetMinutes: z.number().int().min(-840).max(840),
});
