export const recorderMimePriority = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export function microphoneCapability():
  "available" | "insecure" | "unsupported" {
  if (!window.isSecureContext) return "insecure";
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return "unsupported";
  }
  return "available";
}

export function selectRecorderMimeType(
  isSupported: (mimeType: string) => boolean = (mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
): string | null {
  return recorderMimePriority.find((mimeType) => isSupported(mimeType)) ?? null;
}

export function microphoneFailureMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied or dismissed. Allow it in browser settings, then retry, or choose an audio file.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No usable microphone was found. Connect or enable one, or choose an audio file.";
  }
  if (
    error instanceof DOMException &&
    ["NotReadableError", "AbortError"].includes(error.name)
  ) {
    return "The microphone is busy or unavailable. Close other recording apps, then retry.";
  }
  return "Odiina could not start the recorder. Retry or choose an audio file.";
}

export function stopAudioStream(stream: MediaStream | null | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function recordingFilename(mimeType: string, now = Date.now()): string {
  const normalized = mimeType.toLowerCase();
  const extension = normalized.includes("ogg")
    ? "ogg"
    : normalized.includes("mp4")
      ? "m4a"
      : "webm";
  return `odiina-voice-${now}.${extension}`;
}

export function normalizedRecorderMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("ogg")) return "audio/ogg";
  if (normalized.includes("mp4")) return "audio/mp4";
  return "audio/webm";
}

export function formatVoiceDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
