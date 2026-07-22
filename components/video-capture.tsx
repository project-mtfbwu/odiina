"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import {
  formatVideoDuration,
  normalizedVideoMimeType,
  selectVideoRecorderMimeType,
  stopVideoStream,
  videoCaptureCapability,
  videoCaptureFailureMessage,
  videoRecordingFilename,
} from "@/lib/media/video-recorder";
import {
  maximumVideoDurationMs,
  minimumVideoDurationMs,
} from "@/lib/validation/media";

type VideoPhase =
  | "explain"
  | "requesting"
  | "ready"
  | "recording"
  | "review"
  | "unavailable"
  | "failed";

export function VideoCapture({
  isOpen,
  onOpenChange,
  onUseVideo,
  onChooseVideo,
  onNativeCapture,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUseVideo: (file: File, durationMs: number, hasAudio: boolean) => void;
  onChooseVideo: () => void;
  onNativeCapture: () => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const stopReasonRef = useRef<"user" | "limit" | "background" | "interrupted">(
    "user",
  );
  const previewUrlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<VideoPhase>("explain");
  const [message, setMessage] = useState("");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedDuration, setCapturedDuration] = useState(0);
  const [capturedHasAudio, setCapturedHasAudio] = useState(false);

  function stopTimer() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function releaseStream() {
    stopVideoStream(streamRef.current);
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }

  function releaseReview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setCapturedFile(null);
    setCapturedDuration(0);
    setCapturedHasAudio(false);
  }

  function resetAndClose() {
    stopTimer();
    discardRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    releaseStream();
    releaseReview();
    chunksRef.current = [];
    setElapsedMs(0);
    setMessage("");
    setDevices([]);
    setDeviceId(null);
    setPhase("explain");
    onOpenChange(false);
  }

  async function requestCamera(selectedDeviceId?: string, forceSilent = false) {
    releaseStream();
    releaseReview();
    const capability = videoCaptureCapability();
    if (capability !== "available" || !selectVideoRecorderMimeType()) {
      setMessage(
        capability === "insecure"
          ? "Video recording requires HTTPS or localhost. Choose or capture a video with your device picker instead."
          : "This browser cannot make a supported private recording. Choose or capture a video with your device picker instead.",
      );
      setPhase("unavailable");
      return;
    }
    const wantsAudio = audioEnabled && !forceSilent;
    setPhase("requesting");
    setMessage(
      wantsAudio
        ? "Requesting camera and microphone access…"
        : "Requesting camera access without microphone audio…",
    );
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30, max: 60 },
            },
        audio: wantsAudio
          ? {
              channelCount: { ideal: 2 },
              echoCancellation: { ideal: true },
              noiseSuppression: { ideal: true },
            }
          : false,
      });
      streamRef.current = stream;
      const activeVideoTrack = stream.getVideoTracks()[0];
      setDeviceId(
        activeVideoTrack?.getSettings().deviceId ?? selectedDeviceId ?? null,
      );
      for (const track of stream.getTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (recorderRef.current?.state === "recording") {
              stopReasonRef.current = "interrupted";
              recorderRef.current.stop();
            } else {
              releaseStream();
              setMessage(
                "The camera or microphone disconnected. Retry or use the device picker.",
              );
              setPhase("failed");
            }
          },
          { once: true },
        );
      }
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      const available = (
        await navigator.mediaDevices.enumerateDevices()
      ).filter((device) => device.kind === "videoinput");
      setDevices(available);
      if (forceSilent) setAudioEnabled(false);
      setMessage(
        stream.getAudioTracks().length > 0
          ? "Camera and microphone ready. Recording starts only when you press Start recording."
          : "Camera ready without microphone audio. Recording starts only when you press Start recording.",
      );
      setPhase("ready");
    } catch (error) {
      releaseStream();
      if (
        wantsAudio &&
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        setMessage(
          "Camera or microphone permission was denied. You can retry without microphone audio or use the device picker.",
        );
      } else {
        setMessage(videoCaptureFailureMessage(error));
      }
      setPhase("failed");
    }
  }

  function beginRecording() {
    const stream = streamRef.current;
    const mimeType = selectVideoRecorderMimeType();
    if (!stream || !mimeType) {
      releaseStream();
      setMessage("The camera is no longer ready. Retry before recording.");
      setPhase("failed");
      return;
    }
    chunksRef.current = [];
    discardRef.current = false;
    stopReasonRef.current = "user";
    const hasAudio = stream.getAudioTracks().length > 0;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
        ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
      });
    } catch {
      releaseStream();
      setMessage(
        "The recorder could not initialize. Retry or use the device picker.",
      );
      setPhase("failed");
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      discardRef.current = true;
      stopTimer();
      releaseStream();
      setMessage("Recording was interrupted. Retry or use the device picker.");
      setPhase("failed");
    };
    recorder.onstop = () => {
      stopTimer();
      releaseStream();
      if (discardRef.current) {
        chunksRef.current = [];
        return;
      }
      const duration = Math.min(
        maximumVideoDurationMs,
        Math.max(0, Date.now() - startedAtRef.current),
      );
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0 || duration < minimumVideoDurationMs) {
        setMessage(
          "No usable video was captured. Record for at least a moment, then stop.",
        );
        setPhase("failed");
        return;
      }
      const normalizedMime = normalizedVideoMimeType(mimeType);
      const file = new File([blob], videoRecordingFilename(normalizedMime), {
        type: normalizedMime,
        lastModified: Date.now(),
      });
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setCapturedFile(file);
      setCapturedDuration(duration);
      setCapturedHasAudio(hasAudio);
      setElapsedMs(duration);
      setMessage(
        stopReasonRef.current === "limit"
          ? "The five-minute limit was reached. Review your complete local draft."
          : stopReasonRef.current === "background"
            ? "Recording stopped when Odiina moved to the background. Review the recoverable local draft."
            : stopReasonRef.current === "interrupted"
              ? "The camera or microphone disconnected. Review the recoverable local draft."
              : "Review this local video. It has not been uploaded.",
      );
      setPhase("review");
    };
    try {
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setMessage("Recording. Press Stop when you are finished.");
      setPhase("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(Math.min(elapsed, maximumVideoDurationMs));
        if (
          elapsed >= maximumVideoDurationMs &&
          recorder.state === "recording"
        ) {
          stopReasonRef.current = "limit";
          recorder.stop();
        }
      }, 250);
    } catch {
      releaseStream();
      setMessage(
        "The recorder could not start. Retry or use the device picker.",
      );
      setPhase("failed");
    }
  }

  useEffect(() => {
    function visibilityChanged() {
      if (document.visibilityState !== "hidden") return;
      if (recorderRef.current?.state === "recording") {
        stopReasonRef.current = "background";
        recorderRef.current.stop();
      } else if (phase === "ready" || phase === "requesting") {
        releaseStream();
        setMessage(
          "Camera access stopped when Odiina moved to the background. Retry when ready.",
        );
        setPhase("failed");
      }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
  }, [phase]);

  useEffect(
    () => () => {
      stopTimer();
      discardRef.current = true;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      stopVideoStream(streamRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function stopRecording() {
    if (recorderRef.current?.state !== "recording") return;
    stopReasonRef.current = "user";
    recorderRef.current.stop();
  }

  function retake() {
    releaseReview();
    setElapsedMs(0);
    setMessage("");
    setPhase("explain");
  }

  function useVideo() {
    if (!capturedFile) return;
    onUseVideo(capturedFile, capturedDuration, capturedHasAudio);
    resetAndClose();
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) resetAndClose();
      }}
      isDismissable
      className="camera-overlay"
    >
      <Modal className="camera-modal video-capture-modal">
        <Dialog className="outline-none" aria-label="Record a private video">
          <Heading slot="title" className="camera-title">
            Record video
          </Heading>
          {phase === "explain" ? (
            <>
              <p className="camera-copy">
                Odiina requests camera permission only after you continue.
                Microphone audio is optional. Recording starts only when you
                press <strong>Start recording</strong>. The draft stays on this
                device until Send.
              </p>
              <label className="video-audio-choice">
                <input
                  type="checkbox"
                  checked={audioEnabled}
                  onChange={(event) =>
                    setAudioEnabled(event.currentTarget.checked)
                  }
                />
                Include microphone audio
              </label>
              <p className="voice-limit">
                Maximum 5 minutes · 250 MiB · one video per revision
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Cancel
                </Button>
                <Button
                  className="button button-secondary"
                  onPress={() => {
                    resetAndClose();
                    onChooseVideo();
                  }}
                >
                  Choose video
                </Button>
                <Button
                  className="button button-primary"
                  onPress={() => void requestCamera()}
                >
                  Continue
                </Button>
              </div>
            </>
          ) : null}
          {phase === "requesting" ? (
            <div className="camera-state" role="status" aria-live="polite">
              <span className="loading-dot" aria-hidden="true" />
              <p>{message}</p>
              <Button
                className="button button-secondary"
                onPress={resetAndClose}
              >
                Cancel
              </Button>
            </div>
          ) : null}
          {phase === "ready" || phase === "recording" ? (
            <div className="video-live-state">
              <video
                ref={liveVideoRef}
                muted
                playsInline
                className="video-live-preview"
                aria-label="Live camera preview"
              />
              <div className="video-recording-row">
                <span role="status" aria-live="polite">
                  {phase === "recording" ? "Recording" : message}
                </span>
                <strong
                  aria-label={`Elapsed ${formatVideoDuration(elapsedMs)}`}
                >
                  {formatVideoDuration(elapsedMs)}
                </strong>
              </div>
              {phase === "recording" ? (
                <progress
                  max={maximumVideoDurationMs}
                  value={elapsedMs}
                  aria-label="Recording duration toward the five minute limit"
                />
              ) : null}
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  {phase === "recording" ? "Cancel recording" : "Cancel"}
                </Button>
                {phase === "ready" && devices.length > 1 ? (
                  <Button
                    className="button button-secondary"
                    onPress={() => {
                      const index = devices.findIndex(
                        (device) => device.deviceId === deviceId,
                      );
                      const next =
                        devices[(index + 1 + devices.length) % devices.length];
                      if (next) void requestCamera(next.deviceId);
                    }}
                  >
                    Switch camera
                  </Button>
                ) : null}
                <Button
                  className="button button-primary"
                  onPress={
                    phase === "recording" ? stopRecording : beginRecording
                  }
                >
                  {phase === "recording" ? "Stop" : "Start recording"}
                </Button>
              </div>
            </div>
          ) : null}
          {phase === "review" && previewUrl ? (
            <div className="video-review">
              <video
                ref={reviewVideoRef}
                src={previewUrl}
                controls
                playsInline
                preload="metadata"
                className="video-review-player"
                aria-label="Review private video draft"
              />
              <p className="camera-status" role="status" aria-live="polite">
                {message}
              </p>
              <p className="video-review-meta">
                {formatVideoDuration(capturedDuration)} ·{" "}
                {capturedHasAudio ? "with microphone audio" : "silent"}
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Discard
                </Button>
                <Button className="button button-secondary" onPress={retake}>
                  Record again
                </Button>
                <Button
                  className="button button-secondary"
                  onPress={() => {
                    if (!reviewVideoRef.current) return;
                    reviewVideoRef.current.pause();
                    reviewVideoRef.current.currentTime = 0;
                  }}
                >
                  Restart
                </Button>
                <Button className="button button-primary" onPress={useVideo}>
                  Use video
                </Button>
              </div>
            </div>
          ) : null}
          {phase === "failed" || phase === "unavailable" ? (
            <div className="camera-state">
              <p role="alert">{message}</p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Cancel
                </Button>
                <Button
                  className="button button-secondary"
                  onPress={() => {
                    resetAndClose();
                    onChooseVideo();
                  }}
                >
                  Choose video
                </Button>
                <Button
                  className="button button-secondary"
                  onPress={() => {
                    resetAndClose();
                    onNativeCapture();
                  }}
                >
                  Use device camera picker
                </Button>
                {phase === "failed" ? (
                  <Button
                    className="button button-primary"
                    onPress={() => void requestCamera(undefined, audioEnabled)}
                  >
                    {audioEnabled ? "Retry without microphone" : "Retry camera"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
