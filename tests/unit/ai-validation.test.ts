import { describe, expect, it } from "vitest";

import {
  aiSettingsInputSchema,
  derivedDeletionSchema,
  insightScopeSchema,
} from "@/lib/validation/ai";

describe("private AI request validation", () => {
  it("forbids automatic transcription", () => {
    expect(() =>
      aiSettingsInputSchema.parse({
        masterEnabled: true,
        transcriptionEnabled: true,
        insightsEnabled: false,
        transcriptSearchEnabled: false,
        autoTranscribeEnabled: true,
      }),
    ).toThrow();
  });

  it("bounds insight date and media inputs at the route edge", () => {
    expect(() =>
      insightScopeSchema.parse({
        scope: "range",
        entryId: null,
        from: "2026-07-01",
        to: "2026-07-22",
        tags: [],
        media: ["executable"],
        includeAuthoredText: true,
        includeTranscripts: true,
        includePlaceLabels: false,
      }),
    ).toThrow();
  });

  it("requires an explicit deletion phrase", () => {
    expect(() =>
      derivedDeletionSchema.parse({
        kind: "all",
        artifactId: null,
        confirmation: "delete",
      }),
    ).toThrow();
  });
});
