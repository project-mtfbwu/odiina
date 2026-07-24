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

export class FakeChatProvider {
  providerId = "fake-local";
  modelId = "deterministic-chat-v1";
  sendsTextOffDevice = false;

  async answer(request) {
    const fixture = request.fixture;
    if (fixture === "timeout") throw new Error("provider_timeout");
    if (fixture === "rate_limit") throw new Error("provider_rate_limited");
    if (fixture === "malformed") return { answer: 42 };
    if (fixture === "oversized") {
      return {
        answer: "x".repeat(300_000),
        citations: [],
        unsupportedClaimsRemoved: false,
      };
    }

    const evidence = Array.isArray(request.evidence) ? request.evidence : [];
    if (!evidence.length) {
      return {
        answer:
          "I could not find matching evidence in your current Odiina memory. I did not infer an answer from information you did not log.",
        citations: [],
        unsupportedClaimsRemoved: false,
      };
    }
    const citations = evidence.slice(0, 8).map((source) => ({
      sourceId: source.sourceId,
      excerpt: plainEvidence(
        source.transcriptText ||
          source.authoredText ||
          "Selected Odiina evidence",
      ).slice(0, 300),
    }));
    if (fixture === "invalid_citation") {
      citations[0].sourceId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    }
    if (fixture === "unsupported_claim") {
      return {
        answer:
          "I removed an unsupported personal claim. The remaining answer is limited to cited Odiina evidence. [S1]",
        citations: citations.slice(0, 1),
        unsupportedClaimsRemoved: true,
      };
    }

    const question = String(request.question || "");
    const asksAboutVisuals =
      /\b(look|looks|visual|see|shown|appears?)\b/iu.test(question);
    const hasImages = evidence.some((source) => source.hasImage);
    const prefix =
      asksAboutVisuals && hasImages
        ? `I found ${evidence.filter((source) => source.hasImage).length} photo ${evidence.filter((source) => source.hasImage).length === 1 ? "Entry" : "Entries"}, but Odiina has not analyzed their visual content.`
        : `I found ${evidence.length} matching ${evidence.length === 1 ? "memory" : "memories"} in the selected scope.`;
    const details = citations
      .slice(0, 4)
      .map((citation, index) => `${citation.excerpt} [S${index + 1}]`)
      .join(" ");
    return {
      answer: `${prefix}${details ? ` ${details}` : ""}`,
      citations,
      unsupportedClaimsRemoved: false,
    };
  }
}

export function assertProviderOutputSize(value, maximumBytes = 256_000) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maximumBytes) throw new Error("provider_output_too_large");
  return value;
}
