import { z } from "zod";

export const aiSettingsInputSchema = z.object({
  masterEnabled: z.boolean(),
  transcriptionEnabled: z.boolean(),
  insightsEnabled: z.boolean(),
  chatEnabled: z.boolean().default(false),
  semanticMemoryEnabled: z.literal(false).default(false),
  transcriptSearchEnabled: z.boolean(),
  autoTranscribeEnabled: z.literal(false),
  deleteDerivedData: z.boolean().default(false),
});

export const transcriptionRequestSchema = z.object({
  entryId: z.uuid(),
  revisionId: z.uuid(),
  attachmentId: z.uuid(),
  clientRequestId: z.uuid(),
  languageHint: z.string().trim().min(2).max(35).nullable().default(null),
});

export const transcriptCorrectionSchema = z.object({
  segmentId: z.uuid(),
  correctedText: z.string().trim().min(1).max(2_000),
});

export const insightScopeSchema = z.object({
  scope: z.enum(["entry", "day", "range", "week", "month"]),
  entryId: z.uuid().nullable().default(null),
  from: z.iso.date(),
  to: z.iso.date(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  media: z
    .array(z.enum(["text", "image", "audio", "video", "place"]))
    .max(5)
    .default([]),
  includeAuthoredText: z.boolean().default(true),
  includeTranscripts: z.boolean().default(true),
  includePlaceLabels: z.boolean().default(false),
});

export const insightRequestSchema = insightScopeSchema.extend({
  clientRequestId: z.uuid(),
});

export const derivedDeletionSchema = z.object({
  kind: z.enum([
    "transcript",
    "insight",
    "all_transcripts",
    "all_insights",
    "all",
  ]),
  artifactId: z.uuid().nullable().default(null),
  confirmation: z.literal("DELETE AI-DERIVED DATA"),
});
