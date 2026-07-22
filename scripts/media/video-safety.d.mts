export const VIDEO_LIMITS: Readonly<{
  maximumBytes: number;
  minimumDurationMs: number;
  maximumDurationMs: number;
  maximumPixels: number;
  maximumDimension: number;
  maximumFrameRate: number;
  maximumPlaybackDimension: number;
  maximumPlaybackPixels: number;
  maximumPlaybackFrameRate: number;
  maximumPlaybackBytes: number;
  maximumPosterBytes: number;
}>;

export function detectVideoFamily(input: Buffer): "webm" | "iso_bmff";
export function validateVideoDeclaration(input: {
  family: "webm" | "iso_bmff";
  declaredMime: string;
  originalFilename: string;
}): "webm" | "mp4" | "mov";
export function fractionValue(value: string): number;
export function durationFromVideoPacketCsv(value: string): number;
export function assertVideoProcessorHealthy(input: {
  ffmpegPath: string;
  ffprobePath: string;
}): Promise<void>;
export function prepareSafeVideo(
  input: Buffer,
  options: {
    declaredMime: string;
    originalFilename: string;
    ffmpegPath: string;
    ffprobePath: string;
  },
): Promise<{
  container: "webm" | "mp4" | "mov";
  videoCodec: "vp8" | "vp9" | "h264" | "hevc";
  audioCodec: "opus" | "aac" | null;
  hasAudio: boolean;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  rotation: number;
  playback: Buffer;
  playbackWidth: number;
  playbackHeight: number;
  playbackFrameRate: number;
  playbackDurationMs: number;
  poster: Buffer;
  posterWidth: number;
  posterHeight: number;
}>;
