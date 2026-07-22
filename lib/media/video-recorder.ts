export const videoRecorderMimePriority = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
] as const;

export function selectVideoRecorderMimeType(
  isSupported: (mime: string) => boolean = (mime) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime),
): string | null {
  return videoRecorderMimePriority.find((mime) => isSupported(mime)) ?? null;
}

export function normalizedVideoMimeType(
  mime: string,
): "video/webm" | "video/mp4" {
  return mime.toLowerCase().startsWith("video/mp4")
    ? "video/mp4"
    : "video/webm";
}

export function videoRecordingFilename(
  mime: "video/webm" | "video/mp4",
  now = Date.now(),
) {
  return `odiina-video-${now}.${mime === "video/mp4" ? "mp4" : "webm"}`;
}

export function videoCaptureCapability():
  "available" | "insecure" | "unsupported" {
  if (typeof window === "undefined" || !window.isSecureContext)
    return "insecure";
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return "unsupported";
  }
  return "available";
}

export function videoCaptureFailureMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera permission was denied or dismissed. You can retry or use the device video picker.";
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return "No usable camera was found. Choose an existing video or use the device video picker.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The camera is busy or unavailable. Close other camera apps, then retry.";
    }
  }
  return "The camera could not start. Retry or choose an existing video.";
}

export function stopVideoStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function formatVideoDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
