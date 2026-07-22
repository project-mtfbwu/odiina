export function stopMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function cameraCapability(): "available" | "insecure" | "unsupported" {
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return "available";
}

export function cameraFailureMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked. Allow camera access in your browser settings, then retry, or choose a photo instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera was found. Connect or enable a camera, or choose a photo instead.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is busy or unavailable. Close other camera apps, then retry.";
  }
  return "Odiina could not start the camera. Retry or choose a photo instead.";
}
