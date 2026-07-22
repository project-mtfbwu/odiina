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
  cameraCapability,
  cameraFailureMessage,
  stopMediaStream,
} from "@/lib/media/camera";

type CameraPhase =
  "explain" | "requesting" | "live" | "review" | "unavailable" | "failed";

export function CameraCapture({
  isOpen,
  onOpenChange,
  onUsePhoto,
  onChoosePhotos,
  onNativeCapture,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onUsePhoto: (file: File) => void;
  onChoosePhotos: () => void;
  onNativeCapture: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<CameraPhase>("explain");
  const [message, setMessage] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  function releaseCamera() {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function releasePreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setCapturedFile(null);
  }

  function resetAndClose() {
    releaseCamera();
    releasePreview();
    setDevices([]);
    setDeviceId(null);
    setMessage("");
    setPhase("explain");
    onOpenChange(false);
  }

  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "live" || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => {
      releaseCamera();
      setMessage(
        "The live camera preview could not start. Retry or use the device picker.",
      );
      setPhase("failed");
    });
  }, [phase]);

  async function startCamera(requestedDeviceId?: string) {
    releaseCamera();
    releasePreview();
    const capability = cameraCapability();
    if (capability !== "available") {
      setMessage(
        capability === "insecure"
          ? "Live camera capture requires HTTPS or localhost. Use the device camera picker or choose a photo."
          : "This browser does not provide live camera capture. Use the device camera picker or choose a photo.",
      );
      setPhase("unavailable");
      return;
    }
    setMessage("Requesting camera access…");
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: requestedDeviceId
          ? { deviceId: { exact: requestedDeviceId } }
          : { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setDeviceId(activeDeviceId ?? requestedDeviceId ?? null);
      if (navigator.mediaDevices.enumerateDevices) {
        const available = await navigator.mediaDevices.enumerateDevices();
        setDevices(available.filter((device) => device.kind === "videoinput"));
      }
      setMessage(
        "Camera ready. Nothing is recorded or uploaded until you capture and use a photo.",
      );
      setPhase("live");
    } catch (error) {
      releaseCamera();
      setMessage(cameraFailureMessage(error));
      setPhase("failed");
    }
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setMessage(
        "The camera image is not ready yet. Wait for the preview, then retry.",
      );
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      releaseCamera();
      setMessage(
        "Odiina could not prepare this photo. Retry or choose a photo instead.",
      );
      setPhase("failed");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    releaseCamera();
    if (!blob) {
      setMessage(
        "Odiina could not prepare this photo. Retry or choose a photo instead.",
      );
      setPhase("failed");
      return;
    }
    const file = new File([blob], `odiina-camera-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setPreviewUrl(previewUrl);
    setCapturedFile(file);
    setMessage("Review the captured photo. It has not been uploaded.");
    setPhase("review");
  }

  async function switchCamera() {
    if (devices.length < 2) return;
    const current = devices.findIndex((device) => device.deviceId === deviceId);
    const next = devices[(current + 1 + devices.length) % devices.length];
    await startCamera(next.deviceId);
  }

  function usePhoto() {
    if (!capturedFile) return;
    onUsePhoto(capturedFile);
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
      <Modal className="camera-modal">
        <Dialog className="outline-none" aria-label="Take a photo">
          <Heading slot="title" className="camera-title">
            Take a photo
          </Heading>
          {phase === "explain" ? (
            <>
              <p className="camera-copy">
                Odiina requests camera access only after you continue. A
                captured photo stays on this device until you choose{" "}
                <strong>Use photo</strong> and submit the Entry.
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
                    onChoosePhotos();
                  }}
                >
                  Choose photos
                </Button>
                <Button
                  className="button button-primary"
                  onPress={() => void startCamera()}
                >
                  Open camera
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
          {phase === "live" ? (
            <>
              <div className="camera-frame">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  aria-label="Live camera preview"
                />
              </div>
              <p className="camera-status" role="status" aria-live="polite">
                {message}
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Cancel
                </Button>
                {devices.length > 1 ? (
                  <Button
                    className="button button-secondary"
                    onPress={() => void switchCamera()}
                  >
                    Switch camera
                  </Button>
                ) : null}
                <Button
                  className="button button-primary"
                  onPress={() => void capturePhoto()}
                >
                  Capture photo
                </Button>
              </div>
            </>
          ) : null}
          {phase === "review" && previewUrl ? (
            <>
              {/* Local review URL only; rejected captures are revoked and never uploaded. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="camera-review"
                src={previewUrl}
                alt="Camera photo preview"
              />
              <p className="camera-status" role="status" aria-live="polite">
                {message}
              </p>
              <div className="camera-actions">
                <Button
                  className="button button-secondary"
                  onPress={resetAndClose}
                >
                  Discard
                </Button>
                <Button
                  className="button button-secondary"
                  onPress={() => void startCamera(deviceId ?? undefined)}
                >
                  Retake
                </Button>
                <Button className="button button-primary" onPress={usePhoto}>
                  Use photo
                </Button>
              </div>
            </>
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
                    onChoosePhotos();
                  }}
                >
                  Choose photos
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
                    onPress={() => void startCamera()}
                  >
                    Retry camera
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
