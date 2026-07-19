import { z } from "zod";

import { isValidIanaTimezone } from "@/lib/validation/timezone";

const occurrenceSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  occurredTimezone: z
    .string()
    .min(1)
    .max(255)
    .refine(isValidIanaTimezone, "Choose a valid timezone."),
  occurredLocalDate: z.iso.date(),
  occurredUtcOffsetMinutes: z.number().int().min(-840).max(840),
});

export const createEntrySchema = occurrenceSchema.extend({
  clientRequestId: z.uuid(),
  bodyText: z.string().trim().min(1).max(100_000),
});

export const reviseEntrySchema = occurrenceSchema.extend({
  expectedCurrentRevisionId: z.uuid(),
  bodyText: z.string().trim().min(1).max(100_000),
  changeReason: z.enum(["edited", "occurrence_corrected"]),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type ReviseEntryInput = z.infer<typeof reviseEntrySchema>;
