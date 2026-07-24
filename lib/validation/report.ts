import { z } from "zod";

const reportType = z.enum(["daily", "weekly", "monthly", "yearly", "custom"]);
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportPreviewSchema = z.object({
  reportType,
  start: civilDate,
  end: civilDate,
  entryIds: z.array(z.uuid()).max(200).default([]),
});

export const reportCreateSchema = reportPreviewSchema.extend({
  title: z.string().trim().min(1).max(120),
  includePlaces: z.boolean().default(false),
  clientRequestId: z.uuid(),
});

const sectionKinds = z.enum([
  "cover",
  "at_a_glance",
  "timeline",
  "key_moments",
  "photos",
  "voice",
  "video",
  "places",
  "tags",
  "reflection",
]);

export const reportUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  introduction: z.string().max(4000),
  reflection: z.string().max(4000),
  hiddenSections: z.array(sectionKinds).max(10),
  sectionOrder: z
    .array(sectionKinds)
    .length(10)
    .refine((items) => new Set(items).size === 10),
  selectedEntryIds: z.array(z.uuid()).max(200),
  selectedAttachmentIds: z.array(z.uuid()).max(20),
  coverAttachmentId: z.uuid().nullable(),
  insightId: z.uuid().nullable().optional(),
});

export const reportShareSchema = z.object({
  expiresAt: z.iso.datetime(),
  includePlaces: z.boolean().default(false),
  includeMedia: z.literal(false),
  clientRequestId: z.uuid(),
});
