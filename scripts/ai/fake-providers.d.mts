export class FakeTranscriptionProvider {
  readonly providerId: "fake-local";
  readonly modelId: "deterministic-transcript-v1";
  readonly sendsAudioOffDevice: false;
  transcribe(request: {
    jobId: string;
    durationMs: number;
    languageHint?: string | null;
    fixture?: string;
  }): Promise<unknown>;
}

export class FakeInsightProvider {
  readonly providerId: "fake-local";
  readonly modelId: "deterministic-insight-v1";
  readonly sendsTextOffDevice: false;
  generate(request: {
    evidence: Array<Record<string, unknown>>;
    jobId?: string;
    maximumOutputCharacters?: number;
    idempotencyKey?: string;
  }): Promise<unknown>;
}

export class FakeChatProvider {
  readonly providerId: "fake-local";
  readonly modelId: "deterministic-chat-v1";
  readonly sendsTextOffDevice: false;
  answer(request: {
    question: string;
    evidence: Array<Record<string, unknown> & { sourceId: string }>;
    fixture?: string;
  }): Promise<unknown>;
}

export function assertProviderOutputSize<T>(value: T, maximumBytes?: number): T;
