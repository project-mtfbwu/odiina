import { createHash } from "node:crypto";

const injectionPatterns = [
  /ignore (all|any|the) (previous|prior|system) instructions?/giu,
  /system prompt/giu,
  /developer message/giu,
  /reveal (a |the )?(secret|credential|prompt)/giu,
  /<script\b[^>]*>[\s\S]*?<\/script>/giu,
];

function plainEvidence(value) {
  let cleaned = String(value ?? "")
    .replaceAll("<", "")
    .replaceAll(">", "")
    .replace(/\s+/gu, " ")
    .trim();
  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(
      pattern,
      "[instruction-like text preserved as data]",
    );
  }
  return cleaned.slice(0, 600);
}

function shortId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
}

export class FakeTranscriptionProvider {
  providerId = "fake-local";
  modelId = "deterministic-transcript-v1";
  sendsAudioOffDevice = false;

  async transcribe(request) {
    if (request.fixture === "timeout") throw new Error("provider_timeout");
    if (request.fixture === "rate_limit")
      throw new Error("provider_rate_limited");
    const duration = Math.max(1_000, Number(request.durationMs));
    const split = Math.min(duration, Math.max(500, Math.floor(duration / 2)));
    const language = request.languageHint || "en-IN";
    return {
      language,
      languageConfidence: request.languageHint ? null : 0.93,
      timingKind: "segment",
      segments: [
        {
          startMs: 0,
          endMs: split,
          text: language.startsWith("ta")
            ? "Synthetic Tamil-English test segment, வேலை complete."
            : "Synthetic private transcript segment.",
        },
        {
          startMs: split,
          endMs: duration,
          text: `Deterministic evidence ${shortId(request.jobId)}.`,
        },
      ],
    };
  }
}

export class FakeInsightProvider {
  providerId = "fake-local";
  modelId = "deterministic-insight-v1";
  sendsTextOffDevice = false;

  async generate(request) {
    if (!request.evidence.length) throw new Error("insight_sources_empty");
    const citations = request.evidence.slice(0, 8).map((source) => ({
      sourceId: source.sourceId,
      claim: plainEvidence(
        source.authoredText || source.transcriptText || "Selected Entry",
      ).slice(0, 180),
    }));
    return {
      title: "Private evidence summary",
      summary: `This local test summary uses ${request.evidence.length} selected ${request.evidence.length === 1 ? "Entry" : "Entries"}.`,
      keyMoments: citations.slice(0, 4).map((citation) => citation.claim),
      topics: ["Explicitly selected journal evidence"],
      openLoops: [],
      limitations:
        "AI-generated test output may be wrong. It uses only the selected evidence and makes no claim about unobserved activity.",
      citations,
    };
  }
}

export function assertProviderOutputSize(value, maximumBytes = 256_000) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maximumBytes) throw new Error("provider_output_too_large");
  return value;
}
