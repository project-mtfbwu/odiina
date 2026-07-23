import { z } from "zod";

export const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(2_000),
});

export const transcriptionOutputSchema = z.object({
  language: z.string().trim().min(2).max(35),
  languageConfidence: z.number().min(0).max(1).nullable().default(null),
  timingKind: z.enum(["segment", "utterance"]),
  segments: z.array(transcriptSegmentSchema).min(1).max(500),
});

export type TranscriptionOutput = z.infer<typeof transcriptionOutputSchema>;

export type TranscriptionRequest = {
  jobId: string;
  sourceKind: "audio" | "video_audio";
  acceptedBytes: Uint8Array;
  durationMs: number;
  languageHint: string | null;
  idempotencyKey: string;
};

export interface TranscriptionProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly sendsAudioOffDevice: boolean;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionOutput>;
}

export const insightCitationSchema = z.object({
  sourceId: z.string().uuid(),
  claim: z.string().trim().min(1).max(500),
});

export const insightOutputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(4_000),
  keyMoments: z.array(z.string().trim().min(1).max(500)).max(12),
  topics: z.array(z.string().trim().min(1).max(120)).max(12),
  openLoops: z.array(z.string().trim().min(1).max(500)).max(12),
  limitations: z.string().trim().min(1).max(1_000),
  citations: z.array(insightCitationSchema).min(1).max(100),
});

export type InsightOutput = z.infer<typeof insightOutputSchema>;

export type InsightEvidence = {
  sourceId: string;
  entryId: string;
  revisionId: string;
  occurredLocalDate: string;
  authoredText: string | null;
  transcriptText: string | null;
  placeLabel: string | null;
};

export interface InsightProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly sendsTextOffDevice: boolean;
  generate(input: {
    jobId: string;
    evidence: InsightEvidence[];
    maximumOutputCharacters: number;
    idempotencyKey: string;
  }): Promise<InsightOutput>;
}

export function validateTranscriptTiming(
  output: TranscriptionOutput,
  durationMs: number,
  toleranceMs = 1_000,
): TranscriptionOutput {
  const parsed = transcriptionOutputSchema.parse(output);
  let previousStart = -1;
  for (const segment of parsed.segments) {
    if (
      segment.endMs < segment.startMs ||
      segment.startMs < previousStart ||
      segment.endMs > durationMs + toleranceMs
    ) {
      throw new Error("invalid_transcript_timing");
    }
    previousStart = segment.startMs;
  }
  return parsed;
}

export function validateInsightCitations(
  output: InsightOutput,
  allowedSourceIds: ReadonlySet<string>,
): InsightOutput {
  const parsed = insightOutputSchema.parse(output);
  if (
    parsed.citations.some(({ sourceId }) => !allowedSourceIds.has(sourceId))
  ) {
    throw new Error("unsupported_insight_citation");
  }
  return parsed;
}
