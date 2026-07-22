export const AUDIO_LIMITS: Readonly<{
  maximumBytes: number;
  minimumDurationMs: number;
  maximumDurationMs: number;
  maximumChannels: number;
  maximumSampleRate: number;
  waveformPeaks: number;
}>;

export function detectAudioContainer(input: Buffer): "webm" | "ogg" | "m4a";
export function durationFromPacketCsv(output: string): number;
export function validateAudioDeclaration(input: {
  container: "webm" | "ogg" | "m4a";
  declaredMime: string;
  originalFilename: string;
}): void;
export function assertAudioProcessorHealthy(input: {
  ffmpegPath: string;
  ffprobePath: string;
}): Promise<void>;
export function prepareSafeAudio(
  input: Buffer,
  options: {
    declaredMime: string;
    originalFilename: string;
    ffmpegPath: string;
    ffprobePath: string;
  },
): Promise<{
  container: "webm" | "ogg" | "m4a";
  codec: "opus" | "aac";
  durationMs: number;
  channels: number;
  sampleRate: number;
  playback: Buffer;
  playbackDurationMs: number;
  waveformPeaks: number[];
}>;
