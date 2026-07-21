import { z } from "zod";

import {
  isOccurrenceConsistent,
  isValidIanaTimezone,
} from "@/lib/validation/timezone";

const occurrenceFields = {
  occurredAt: z.iso.datetime({ offset: true }),
  occurredTimezone: z
    .string()
    .min(1)
    .max(255)
    .refine(isValidIanaTimezone, "Choose a valid timezone."),
  occurredLocalDate: z.iso.date(),
  occurredUtcOffsetMinutes: z.number().int().min(-840).max(840),
};

export const createEntrySchema = z
  .object({
    ...occurrenceFields,
    clientRequestId: z.uuid(),
    bodyText: z.string().trim().min(1).max(100_000),
  })
  .refine(isOccurrenceConsistent, {
    message: "Choose a valid occurrence date and time.",
  });

export const reviseEntrySchema = z
  .object({
    ...occurrenceFields,
    expectedCurrentRevisionId: z.uuid(),
    bodyText: z.string().max(100_000),
    attachmentIds: z
      .array(z.uuid())
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    changeReason: z.enum(["edited", "occurrence_corrected"]),
  })
  .refine(isOccurrenceConsistent, {
    message: "Choose a valid occurrence date and time.",
  });

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type ReviseEntryInput = z.infer<typeof reviseEntrySchema>;
