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
  formatVoiceDuration,
  microphoneCapability,
  microphoneFailureMessage,
  normalizedRecorderMimeType,
  recordingFilename,
  selectRecorderMimeType,
  stopAudioStream,
} from "@/lib/media/recorder";
import {
  maximumAudioDurationMs,
  minimumAudioDurationMs,
} from "@/lib/validation/media";

type VoicePhase =
  | "explain"
  | "requesting"
  | "ready"
  | "recording"
  | "review"
  | "unavailable"
  | "failed";

export function VoiceCapture({
  isOpen,
  onOpenChange,
  onUseVoice,
  onChooseAudio,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUseVoice: (file: File, durationMs: number) => void;
  onChooseAudio: () => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopReasonRef = useRef<"user" | "limit" | "background" | "interrupted">(
    "user",
  );
  const discardRecordingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const reviewAudioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<VoicePhase>("explain");
  const [message, setMessage] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [reviewPosition, setReviewPosition] = useState(0);
  const [reviewPlaying, setReviewPlaying] = useState(false);

  function stopTimer() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function releaseMicrophone() {
    stopAudioStream(streamRef.current);
    streamRef.current = null;
  }

  function releasePreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setCapturedFile(null);
    setDurationMs(0);
    setReviewPosition(0);
    setReviewPlaying(false);
  }

  function resetAndClose() {
    stopTimer();
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    releaseMicrophone();
    releasePreview();
    chunksRef.current = [];
    setElapsedMs(0);
    setMessage("");
    setPhase("explain");
    onOpenChange(false);
  }

  useEffect(() => {
    function visibilityChanged() {
      if (document.visibilityState !== "hidden") return;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") {
        stopReasonRef.current = "background";
        recorder.stop();
        stopTimer();
        releaseMicrophone();
      } else if (phase === "ready") {
        releaseMicrophone();
        setMessage(
          "Microphone access stopped when this page moved to the background. Retry when you are ready.",
        );
        setPhase("failed");
      }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () =>
      document.removeEventListener("visibilitychange", visibilityChanged);
  }, [phase]);

  useEffect(() => {
    return () => {
      stopTimer();
      discardRecordingRef.current = true;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      stopAudioStream(streamRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  async function requestMicrophone() {
    releaseMicrophone();
    releasePreview();
    const capability = microphoneCapability();
    if (capability !== "available") {
      setMessage(
        capability === "insecure"
          ? "Microphone recording requires HTTPS or localhost. Choose an existing audio file instead."
          : "This browser does not support private live recording. Choose an existing audio file instead.",
      );
      setPhase("unavailable");
      return;
    }
    if (!selectRecorderMimeType()) {
      setMessage(
        "This browser cannot create one of Odiina's supported voice formats. Choose an audio file instead.",
      );
      setPhase("unavailable");
      return;
    }
    setPhase("requesting");
    setMessage("Requesting microphone access…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
        video: false,
      });
      streamRef.current = stream;
      for (const track of stream.getAudioTracks()) {
        track.addEventListener(
          "ended",
          () => {
            const recorder = recorderRef.current;
            if (recorder?.state === "recording") {
              stopReasonRef.current = "interrupted";
              recorder.stop();
            }
            releaseMicrophone();
          },
          { once: true },
        );
      }
      setMessage(
        "Microphone ready. Recording starts only when you press Start recording.",
      );
      setPhase("ready");
    } catch (error) {
      releaseMicrophone();
      setMessage(microphoneFailureMessage(error));
      setPhase("failed");
    }
  }

  function beginRecording() {
    const stream = streamRef.current;
    const mimeType = selectRecorderMimeType();
    if (!stream || !mimeType) {
      setMessage("The microphone is no longer ready. Retry before recording.");
      setPhase("failed");
      releaseMicrophone();
      return;
    }
    chunksRef.current = [];
    discardRecordingRef.current = false;
    stopReasonRef.current = "user";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: 128_000,
    });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      discardRecordingRef.current = true;
      stopTimer();
      releaseMicrophone();
      setMessage("Recording was interrupted. Retry or choose an audio file.");
      setPhase("failed");
    };
    recorder.onstop = () => {
      stopTimer();
      releaseMicrophone();
      if (discardRecordingRef.current) {
        chunksRef.current = [];
        return;
      }
      const capturedDuration = Math.min(
        maximumAudioDurationMs,
        Math.max(0, Date.now() - startedAtRef.current),
      );
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0 || capturedDuration < minimumAudioDurationMs) {
        setMessage(
          "No usable voice note was captured. Record for at least a moment, then stop.",
        );
        setPhase("failed");
        return;
      }
      const normalizedMime = normalizedRecorderMimeType(mimeType);
      const file = new File([blob], recordingFilename(normalizedMime), {
        type: normalizedMime,
        lastModified: Date.now(),
      });
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setCapturedFile(file);
      setDurationMs(capturedDuration);
      setElapsedMs(capturedDuration);
      setMessage(
        stopReasonRef.current === "limit"
          ? "The 10-minute limit was reached. Your complete captured draft is ready to review."
          : stopReasonRef.current === "background"
            ? "Recording stopped when the page moved to the background. Review the recoverable draft before using it."
            : stopReasonRef.current === "interrupted"
              ? "The microphone disconnected. Review the recoverable draft before using it."
              : "Review this local voice note. It has not been uploaded.",
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
        setElapsedMs(Math.min(elapsed, maximumAudioDurationMs));
        if (
          elapsed >= maximumAudioDurationMs &&
          recorder.state === "recording"
        ) {
          stopReasonRef.current = "limit";
          recorder.stop();
        }
      }, 250);
    } catch {
      releaseMicrophone();
      setMessage(
        "The recorder could not start. Retry or choose an audio file.",
      );
      setPhase("failed");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "recording") return;
    stopReasonRef.current = "user";
    recorderRef.current.stop();
  }

  function retake() {
    releasePreview();
    setElapsedMs(0);
    setMessage("");
    setPhase("explain");
  }

  function useVoice() {
    if (!capturedFile) return;
    onUseVoice(capturedFile, durationMs);
    resetAndClose();
  }

  async function toggleReview() {
    const audio = reviewAudioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
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
      <Modal className="camera-modal voice-capture-modal">
        <Dialog
          className="outline-none"
          aria-label="Record a private voice note"
        >
          <Heading slot="title" className="camera-title">
            Record a voice note
          </Heading>
          {phase === "explain" ? (
            <>
              <p className="camera-copy">
                Odiina requests microphone access only after you continue.
                Recording then starts only when you press{" "}
                <strong>Start recording</strong>. Your draft stays on this
                device until you use it and send the Entry.
              </p>
              <p className="voice-limit">
                Maximum 10 minutes · one voice note per revision
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
                    onChooseAudio();
                  }}
                >
                  Choose audio file
                </Button>
                <Button
                  className="button button-primary"
                  onPress={() => void requestMicrophone()}
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
          {phase === "ready" ? (
            <div className="voice-record-state">
              <div className="voice-ready-mark" aria-hidden="true" />
              <p role="status" aria-live="polite">
                {message}
              </p>
              <p
                className="voice-timer"
                aria-label="Recording duration zero minutes zero seconds"
              >
                0:00
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Cancel
                </Button>
                <Button
                  className="button button-primary"
                  onPress={beginRecording}
                >
                  Start recording
                </Button>
              </div>
            </div>
          ) : null}
          {phase === "recording" ? (
            <div className="voice-record-state voice-recording">
              <div className="voice-recording-label">
                <span className="voice-recording-dot" aria-hidden="true" />
                <span role="status" aria-live="polite">
                  Recording
                </span>
              </div>
              <p
                className="voice-timer"
                aria-label={`Elapsed ${formatVoiceDuration(elapsedMs)}`}
              >
                {formatVoiceDuration(elapsedMs)}
              </p>
              <progress
                className="voice-limit-progress"
                max={maximumAudioDurationMs}
                value={elapsedMs}
                aria-label="Recording duration toward the 10 minute limit"
              />
              <p className="voice-limit">
                Stops cleanly at 10:00. Moving this page to the background stops
                recording.
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Cancel recording
                </Button>
                <Button
                  className="button button-primary voice-stop"
                  onPress={stopRecording}
                >
                  Stop
                </Button>
              </div>
            </div>
          ) : null}
          {phase === "review" && previewUrl ? (
            <div className="voice-review">
              <audio
                ref={reviewAudioRef}
                src={previewUrl}
                preload="metadata"
                onPlay={() => setReviewPlaying(true)}
                onPause={() => setReviewPlaying(false)}
                onEnded={() => setReviewPlaying(false)}
                onTimeUpdate={(event) =>
                  setReviewPosition(event.currentTarget.currentTime)
                }
              />
              <p className="voice-review-heading">Review before using</p>
              <p className="camera-status" role="status" aria-live="polite">
                {message}
              </p>
              <div className="voice-review-controls">
                <Button
                  className="voice-control-button"
                  onPress={() => void toggleReview()}
                >
                  {reviewPlaying ? "Pause" : "Play"}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(durationMs / 1000, 0.25)}
                  step={0.01}
                  value={reviewPosition}
                  aria-label="Seek voice-note draft"
                  onChange={(event) => {
                    const position = Number(event.currentTarget.value);
                    if (reviewAudioRef.current)
                      reviewAudioRef.current.currentTime = position;
                    setReviewPosition(position);
                  }}
                />
                <span
                  aria-label={`Total duration ${formatVoiceDuration(durationMs)}`}
                >
                  {formatVoiceDuration(reviewPosition * 1000)} /{" "}
                  {formatVoiceDuration(durationMs)}
                </span>
                <Button
                  className="voice-control-button"
                  onPress={() => {
                    if (!reviewAudioRef.current) return;
                    reviewAudioRef.current.currentTime = 0;
                    setReviewPosition(0);
                  }}
                >
                  Restart
                </Button>
              </div>
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
                <Button className="button button-primary" onPress={useVoice}>
                  Use voice note
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
                    onChooseAudio();
                  }}
                >
                  Choose audio file
                </Button>
                {phase === "failed" ? (
                  <Button
                    className="button button-primary"
                    onPress={() => void requestMicrophone()}
                  >
                    Retry microphone
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
