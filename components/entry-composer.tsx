"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Button,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  TextArea,
  TextField,
} from "react-aria-components";
import type { Upload } from "tus-js-client";

import { CameraCapture } from "@/components/camera-capture";
import { PlacePicker } from "@/components/place-picker";
import { VideoCapture } from "@/components/video-capture";
import { VoiceCapture } from "@/components/voice-capture";
import {
  CalendarIcon,
  CameraIcon,
  ImageIcon,
  LocationIcon,
  MicrophoneIcon,
  PlusIcon,
  SendIcon,
  VideoIcon,
} from "@/components/icons";
import {
  abortImageUploads,
  cancelImageAttempt,
  processImageDraft,
  type ImageDraft,
} from "@/lib/media/client-upload";
import {
  processAudioDraft,
  type AudioDraft,
} from "@/lib/media/client-audio-upload";
import { formatVoiceDuration } from "@/lib/media/recorder";
import {
  processVideoDraft,
  type VideoDraft,
} from "@/lib/media/client-video-upload";
import { formatVideoDuration } from "@/lib/media/video-recorder";
import {
  acceptedAudioMimeTypes,
  acceptedImageMimeTypes,
  maximumAudioBytes,
  maximumAudioDurationMs,
  maximumEntryImages,
  maximumImageBytes,
  acceptedVideoMimeTypes,
  maximumVideoBytes,
  maximumVideoDurationMs,
  minimumVideoDurationMs,
  minimumAudioDurationMs,
} from "@/lib/validation/media";
import type { PlaceSnapshotInput } from "@/lib/validation/place";
import {
  localCivilDate,
  localTime,
  occurrenceFromLocalDateTime,
} from "@/lib/validation/timezone";

const maximumLength = 100_000;
function humanBytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function EntryComposer({
  csrfToken,
  timezone,
  initialOccurrenceDate,
  inline = false,
}: {
  csrfToken: string;
  timezone: string;
  initialOccurrenceDate?: string;
  inline?: boolean;
}) {
  const initialNow = useMemo(() => new Date(), []);
  const initialLocalDate =
    initialOccurrenceDate ?? localCivilDate(initialNow, timezone);
  const chooseInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const nativeVideoInput = useRef<HTMLInputElement>(null);
  const videoPreview = useRef<HTMLVideoElement>(null);
  const activeUploads = useRef(new Map<string, Upload>());
  const draftEntryId = useRef<string | null>(null);
  const previewUrls = useRef(new Set<string>());
  const [body, setBody] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState(initialLocalDate);
  const [occurrenceTime, setOccurrenceTime] = useState(
    localTime(initialNow, timezone),
  );
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [audio, setAudio] = useState<AudioDraft | null>(null);
  const [video, setVideo] = useState<VideoDraft | null>(null);
  const [place, setPlace] = useState<PlaceSnapshotInput | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [clientRequestId, setClientRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stageAnnouncement, setStageAnnouncement] = useState("");
  const remaining = maximumLength - Array.from(body).length;
  const valid =
    (body.trim().length > 0 ||
      images.length > 0 ||
      audio !== null ||
      video !== null ||
      place !== null) &&
    remaining >= 0;
  const hasFailedUploads =
    images.some((image) => image.stage === "Failed") ||
    audio?.stage === "Failed" ||
    video?.stage === "Failed";
  const today = localCivilDate(initialNow, timezone);
  const isSelectedDay = occurrenceDate !== today;
  const submitLabel = isSelectedDay
    ? `Add to ${occurrenceDate}`
    : "Add to today";
  const shortcut = useMemo(
    () =>
      typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
        ? "⌘ Enter"
        : "Ctrl Enter",
    [],
  );

  useEffect(() => {
    const uploads = activeUploads.current;
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      void abortImageUploads(uploads);
    };
  }, []);

  function updateImage(id: string, update: Partial<ImageDraft>) {
    setImages((current) =>
      current.map((image) =>
        image.id === id ? { ...image, ...update } : image,
      ),
    );
  }

  function updateAudio(update: Partial<AudioDraft>) {
    setAudio((current) => (current ? { ...current, ...update } : current));
  }

  function updateVideo(update: Partial<VideoDraft>) {
    setVideo((current) => (current ? { ...current, ...update } : current));
  }

  function addVoice(file: File, durationMs: number) {
    if (video) {
      setError(
        "A voice note and video cannot share one revision. Remove the video first.",
      );
      return;
    }
    if (audio) {
      setError("Discard the selected voice note before choosing another one.");
      return;
    }
    if (
      !acceptedAudioMimeTypes.includes(
        file.type as (typeof acceptedAudioMimeTypes)[number],
      )
    ) {
      setError("Choose WebM/Opus, Ogg/Opus, or M4A/AAC audio only.");
      return;
    }
    if (file.size < 1 || file.size > maximumAudioBytes) {
      setError("A voice note must be no larger than 25 MiB.");
      return;
    }
    if (
      durationMs < minimumAudioDurationMs ||
      durationMs > maximumAudioDurationMs
    ) {
      setError("A voice note must be between a moment and 10 minutes long.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    setAudio({
      id: crypto.randomUUID(),
      file,
      previewUrl,
      durationMs,
      progress: 0,
      stage: "Selected",
    });
    setSaved(false);
    setError(null);
    setStageAnnouncement("Voice note selected. Nothing has been uploaded.");
  }

  async function audioFileDuration(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<number>((resolve, reject) => {
        const element = document.createElement("audio");
        element.preload = "metadata";
        element.onloadedmetadata = () =>
          Number.isFinite(element.duration)
            ? resolve(Math.round(element.duration * 1000))
            : reject(new Error("duration_unavailable"));
        element.onerror = () => reject(new Error("duration_unavailable"));
        element.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function selectAudioFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      addVoice(file, await audioFileDuration(file));
    } catch {
      setError(
        "Odiina could not read this audio draft. Choose another supported file.",
      );
    }
  }

  function removeAudio() {
    if (!audio) return;
    URL.revokeObjectURL(audio.previewUrl);
    previewUrls.current.delete(audio.previewUrl);
    if (audio.attachmentId && audio.stage !== "Ready") {
      void cancelImageAttempt(csrfToken, audio.attachmentId).catch(() => {});
    }
    setAudio(null);
    setStageAnnouncement("Voice note removed from this unsaved Entry.");
  }

  async function videoFileMetadata(file: File) {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<{
        durationMs: number;
        width: number;
        height: number;
        hasAudio: boolean | null;
      }>((resolve, reject) => {
        const element = document.createElement("video") as HTMLVideoElement & {
          audioTracks?: { length: number };
          mozHasAudio?: boolean;
          webkitAudioDecodedByteCount?: number;
        };
        element.preload = "metadata";
        element.onloadedmetadata = () => {
          if (
            !Number.isFinite(element.duration) ||
            !element.videoWidth ||
            !element.videoHeight
          ) {
            reject(new Error("video_metadata_unavailable"));
            return;
          }
          const hasAudio = element.audioTracks
            ? element.audioTracks.length > 0
            : typeof element.mozHasAudio === "boolean"
              ? element.mozHasAudio
              : typeof element.webkitAudioDecodedByteCount === "number"
                ? element.webkitAudioDecodedByteCount > 0
                : null;
          resolve({
            durationMs: Math.round(element.duration * 1000),
            width: element.videoWidth,
            height: element.videoHeight,
            hasAudio,
          });
        };
        element.onerror = () => reject(new Error("video_metadata_unavailable"));
        element.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function addVideo(
    file: File,
    durationMs: number,
    hasAudio: boolean | null,
    width = 0,
    height = 0,
  ) {
    if (audio) {
      setError(
        "A video and voice note cannot share one revision. Remove the voice note first.",
      );
      return;
    }
    if (video) {
      setError("Remove the selected video before choosing another one.");
      return;
    }
    if (
      !acceptedVideoMimeTypes.includes(
        file.type as (typeof acceptedVideoMimeTypes)[number],
      )
    ) {
      setError("Choose WebM, MP4, M4V, or MOV video only.");
      return;
    }
    if (file.size < 1 || file.size > maximumVideoBytes) {
      setError("A video must be no larger than 250 MiB.");
      return;
    }
    if (
      durationMs < minimumVideoDurationMs ||
      durationMs > maximumVideoDurationMs
    ) {
      setError(
        "A video must be between a moment and five minutes long. Odiina never trims it silently.",
      );
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    setVideo({
      id: crypto.randomUUID(),
      file,
      previewUrl,
      durationMs,
      width,
      height,
      hasAudio,
      progress: 0,
      stage: "Selected",
    });
    setSaved(false);
    setError(null);
    setStageAnnouncement("Video selected. Nothing has been uploaded.");
  }

  async function selectVideoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const metadata = await videoFileMetadata(file);
      addVideo(
        file,
        metadata.durationMs,
        metadata.hasAudio,
        metadata.width,
        metadata.height,
      );
    } catch {
      setError(
        "Odiina could not review this video locally. Choose another supported file.",
      );
    }
  }

  function removeVideo() {
    if (!video) return;
    URL.revokeObjectURL(video.previewUrl);
    previewUrls.current.delete(video.previewUrl);
    if (video.attachmentId && video.stage !== "Ready") {
      void cancelImageAttempt(csrfToken, video.attachmentId).catch(() => {});
    }
    setVideo(null);
    setStageAnnouncement("Video removed from this unsaved Entry.");
  }

  function addFiles(chosen: File[]) {
    setError(null);
    const room = maximumEntryImages - images.length;
    if (chosen.length > room) {
      setError(`You can attach up to ${maximumEntryImages} photos.`);
    }
    const accepted: ImageDraft[] = [];
    for (const file of chosen.slice(0, room)) {
      if (
        !acceptedImageMimeTypes.includes(
          file.type as (typeof acceptedImageMimeTypes)[number],
        )
      ) {
        setError("Choose JPEG, PNG, or WebP images only.");
        continue;
      }
      if (file.size < 1 || file.size > maximumImageBytes) {
        setError("Each image must be no larger than 15 MiB.");
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl,
        progress: 0,
        stage: "Selected",
      });
    }
    setImages((current) => [...current, ...accepted]);
    setSaved(false);
    if (accepted.length > 0) {
      setStageAnnouncement(
        `${accepted.length} ${accepted.length === 1 ? "photo" : "photos"} selected. Nothing has been uploaded.`,
      );
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrls.current.delete(target.previewUrl);
      }
      return current.filter((image) => image.id !== id);
    });
    setStageAnnouncement("Photo removed from the selection.");
  }

  function clearImages() {
    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
      previewUrls.current.delete(image.previewUrl);
    }
    setImages([]);
    setStageAnnouncement("Photo selection cleared.");
  }

  function moveImage(index: number, delta: -1 | 1) {
    setImages((current) => {
      const destination = index + delta;
      if (destination < 0 || destination >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [
        reordered[destination],
        reordered[index],
      ];
      return reordered;
    });
    setStageAnnouncement(
      `Image moved ${delta < 0 ? "earlier" : "later"} in the Entry.`,
    );
  }

  async function jsonRequest<T>(url: string, payload: object): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-odiina-csrf": csrfToken,
      },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      throw new Error(result.message ?? "Odiina could not process the image.");
    }
    return result;
  }

  async function cancelUploads() {
    setCancelling(true);
    await abortImageUploads(activeUploads.current);
    const ids = images.flatMap((image) =>
      image.attachmentId && image.stage !== "Ready" ? [image.attachmentId] : [],
    );
    if (audio?.attachmentId && audio.stage !== "Ready") {
      ids.push(audio.attachmentId);
    }
    if (video?.attachmentId && video.stage !== "Ready")
      ids.push(video.attachmentId);
    await Promise.allSettled(
      ids.map((attachmentId) => cancelImageAttempt(csrfToken, attachmentId)),
    );
    setImages((current) =>
      current.map((image) =>
        image.stage === "Ready"
          ? image
          : { ...image, stage: "Failed", error: "Upload cancelled." },
      ),
    );
    if (audio && audio.stage !== "Ready") {
      updateAudio({ stage: "Failed", error: "Upload cancelled." });
    }
    if (video && video.stage !== "Ready") {
      updateVideo({ stage: "Failed", error: "Upload cancelled." });
    }
    setBusy(false);
    setCancelling(false);
    setStageAnnouncement("Media upload cancelled.");
  }

  async function submit() {
    if (!valid || busy) return;
    if (!navigator.onLine) {
      setError(
        "You are offline. Your text and selected media remain here; reconnect to save.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    let occurrence;
    try {
      occurrence = occurrenceFromLocalDateTime(
        occurrenceDate,
        occurrenceTime,
        timezone,
      );
    } catch {
      setError(
        "Choose a valid local date and time. Times skipped by a daylight-saving change cannot be used.",
      );
      setBusy(false);
      return;
    }
    try {
      if (images.length === 0 && !audio && !video) {
        await jsonRequest("/api/entries", {
          clientRequestId,
          bodyText: body,
          ...(place ? { place } : {}),
          ...occurrence,
        });
      } else {
        let activeDraftId =
          draftEntryId.current ??
          images.find((image) => image.entryId)?.entryId ??
          audio?.entryId ??
          video?.entryId ??
          null;
        const attachmentIds: string[] = [];
        for (const image of images) {
          try {
            const processed = await processImageDraft({
              image,
              entryId: activeDraftId,
              csrfToken,
              activeUploads: activeUploads.current,
              update: (update) => updateImage(image.id, update),
              announce: setStageAnnouncement,
            });
            activeDraftId = processed.entryId;
            draftEntryId.current = processed.entryId;
            attachmentIds.push(processed.attachmentId);
          } catch (caught) {
            const message =
              caught instanceof Error
                ? caught.message
                : "Odiina could not process this image.";
            updateImage(image.id, { stage: "Failed", error: message });
            throw caught;
          }
        }
        if (audio) {
          try {
            const processed = await processAudioDraft({
              audio,
              entryId: activeDraftId,
              csrfToken,
              activeUploads: activeUploads.current,
              update: updateAudio,
              announce: setStageAnnouncement,
            });
            activeDraftId = processed.entryId;
            draftEntryId.current = processed.entryId;
            attachmentIds.push(processed.attachmentId);
          } catch (caught) {
            const message =
              caught instanceof Error
                ? caught.message
                : "Odiina could not process this voice note.";
            updateAudio({ stage: "Failed", error: message });
            throw caught;
          }
        }
        if (video) {
          try {
            const processed = await processVideoDraft({
              video,
              entryId: activeDraftId,
              csrfToken,
              activeUploads: activeUploads.current,
              update: updateVideo,
              announce: setStageAnnouncement,
            });
            activeDraftId = processed.entryId;
            draftEntryId.current = processed.entryId;
            attachmentIds.push(processed.attachmentId);
          } catch (caught) {
            const message =
              caught instanceof Error
                ? caught.message
                : "Odiina could not process this video.";
            updateVideo({ stage: "Failed", error: message });
            throw caught;
          }
        }
        await jsonRequest("/api/media/activate", {
          clientRequestId,
          entryId: activeDraftId,
          bodyText: body,
          attachmentIds,
          ...(place ? { place } : {}),
          ...occurrence,
        });
      }
      for (const image of images) {
        URL.revokeObjectURL(image.previewUrl);
        previewUrls.current.delete(image.previewUrl);
      }
      setImages([]);
      if (audio) {
        URL.revokeObjectURL(audio.previewUrl);
        previewUrls.current.delete(audio.previewUrl);
      }
      setAudio(null);
      if (video) {
        URL.revokeObjectURL(video.previewUrl);
        previewUrls.current.delete(video.previewUrl);
      }
      setVideo(null);
      setPlace(null);
      draftEntryId.current = null;
      setBody("");
      setClientRequestId(crypto.randomUUID());
      setSaved(true);
      setStageAnnouncement("Entry added to your Odiina Feed.");
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Odiina could not save this Entry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={["composer-shell", inline ? "composer-shell-inline" : null]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby="capture-heading"
    >
      <div className="composer-heading">
        <div>
          <h2 id="capture-heading" className="m-0 text-base font-bold">
            Capture a moment
          </h2>
        </div>
        <span className="composer-timezone">{timezone}</span>
      </div>

      {error ? (
        <div className="form-error mb-4" id="capture-error" role="alert">
          {error}
        </div>
      ) : null}

      <TextField
        className="field"
        value={body}
        onChange={(value) => {
          setBody(value);
          setClientRequestId(crypto.randomUUID());
          setSaved(false);
          setError(null);
        }}
        isInvalid={remaining < 0}
      >
        <Label className="sr-only">
          Entry text (optional with private media)
        </Label>
        <TextArea
          id="entry-body"
          className="composer-textarea"
          placeholder="Log something…"
          maxLength={maximumLength}
          aria-describedby={error ? "capture-error" : undefined}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              valid
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          onInput={(event) => {
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 128)}px`;
          }}
        />
      </TextField>

      <div className="occurrence-controls" aria-label="When this happened">
        <CalendarIcon className="size-5" />
        <label>
          <span>Occurrence date</span>
          <input
            type="date"
            value={occurrenceDate}
            onChange={(event) => {
              setOccurrenceDate(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label>
          <span>Occurrence time</span>
          <input
            type="time"
            value={occurrenceTime}
            onChange={(event) => {
              setOccurrenceTime(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <Button
          className="occurrence-now"
          onPress={() => {
            const now = new Date();
            setOccurrenceDate(localCivilDate(now, timezone));
            setOccurrenceTime(localTime(now, timezone));
            setSaved(false);
          }}
        >
          Now
        </Button>
      </div>
      {isSelectedDay ? (
        <p className="occurrence-context" role="status">
          This Entry will appear on {occurrenceDate}. Its actual recording time
          remains unchanged.
        </p>
      ) : null}

      {place ? (
        <div
          className="place-draft"
          role="status"
          aria-label="Selected private place"
        >
          <LocationIcon className="size-5" />
          <div>
            <strong>{place.placeName}</strong>
            {place.placeArea ? <span>{place.placeArea}</span> : null}
            <small>
              {place.precision === "label_only"
                ? "Label only · no coordinates"
                : place.precision === "approximate"
                  ? "Approximate · about 3 km"
                  : "Exact · private"}
            </small>
          </div>
          <Button
            className="button button-secondary"
            onPress={() => setPlaceOpen(true)}
          >
            Change
          </Button>
          <Button
            className="button button-secondary"
            onPress={() => {
              setPlace(null);
              setClientRequestId(crypto.randomUUID());
              setStageAnnouncement("Place removed from this unsaved Entry.");
            }}
          >
            Remove
          </Button>
        </div>
      ) : null}

      <div className="composer-tools">
        <MenuTrigger>
          <Button className="composer-icon-button" aria-label="Add media">
            <PlusIcon className="size-6" />
          </Button>
          <Popover className="composer-popover" placement="top start">
            <Menu className="composer-menu" aria-label="Capture options">
              <MenuItem onAction={() => chooseInput.current?.click()}>
                <ImageIcon className="size-5" /> Choose photos
              </MenuItem>
              <MenuItem
                onAction={() => {
                  setVoiceOpen(false);
                  setCameraOpen(true);
                }}
              >
                <CameraIcon className="size-5" /> Take photo
              </MenuItem>
              <MenuItem
                onAction={() => {
                  setCameraOpen(false);
                  setVoiceOpen(false);
                  setVideoOpen(true);
                }}
                isDisabled={Boolean(video) || Boolean(audio)}
              >
                <VideoIcon className="size-5" /> Record video
              </MenuItem>
              <MenuItem
                onAction={() => {
                  setCameraOpen(false);
                  setVoiceOpen(true);
                }}
                isDisabled={Boolean(audio) || Boolean(video)}
              >
                <MicrophoneIcon className="size-5" /> Record voice note
              </MenuItem>
              <MenuItem
                onAction={() => audioInput.current?.click()}
                isDisabled={Boolean(audio) || Boolean(video)}
              >
                <MicrophoneIcon className="size-5" /> Choose audio file
              </MenuItem>
              <MenuItem
                onAction={() => videoInput.current?.click()}
                isDisabled={Boolean(video) || Boolean(audio)}
              >
                <VideoIcon className="size-5" /> Choose video
              </MenuItem>
              <MenuItem onAction={() => setPlaceOpen(true)}>
                <LocationIcon className="size-5" /> Add place
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
        <Button
          className="composer-icon-button"
          onPress={() => {
            setVoiceOpen(false);
            setVideoOpen(false);
            setCameraOpen(true);
          }}
          isDisabled={busy || images.length >= maximumEntryImages}
          aria-label="Take a photo"
        >
          <CameraIcon className="size-5" />
        </Button>
        <Button
          className="composer-icon-button"
          onPress={() => {
            setCameraOpen(false);
            setVideoOpen(false);
            setVoiceOpen(true);
          }}
          isDisabled={busy || Boolean(audio) || Boolean(video)}
          aria-label={
            audio || video
              ? "Remove the selected voice note or video first"
              : "Record a voice note"
          }
        >
          <MicrophoneIcon className="size-5" />
        </Button>
        <input
          ref={audioInput}
          className="sr-only"
          type="file"
          accept={acceptedAudioMimeTypes.join(",")}
          aria-label="Choose an existing audio file"
          onChange={(event) => void selectAudioFile(event)}
          disabled={busy || Boolean(audio) || Boolean(video)}
        />
        <input
          ref={videoInput}
          className="sr-only"
          type="file"
          accept={acceptedVideoMimeTypes.join(",")}
          aria-label="Choose an existing video"
          onChange={(event) => void selectVideoFile(event)}
          disabled={busy || Boolean(video) || Boolean(audio)}
        />
        <input
          ref={nativeVideoInput}
          className="sr-only"
          type="file"
          accept="video/*"
          capture="environment"
          aria-label="Record a video with the device camera picker"
          onChange={(event) => void selectVideoFile(event)}
          disabled={busy || Boolean(video) || Boolean(audio)}
        />
        <input
          ref={cameraInput}
          className="sr-only"
          type="file"
          accept={acceptedImageMimeTypes.join(",")}
          capture="environment"
          aria-label="Take a photo with the device camera"
          onChange={selectFiles}
          disabled={busy}
        />
        <input
          ref={chooseInput}
          className="sr-only"
          type="file"
          accept={acceptedImageMimeTypes.join(",")}
          multiple
          aria-label="Choose one or more photos"
          onChange={selectFiles}
          disabled={busy}
        />
        <CameraCapture
          isOpen={cameraOpen}
          onOpenChange={setCameraOpen}
          onUsePhoto={(file) => addFiles([file])}
          onChoosePhotos={() => chooseInput.current?.click()}
          onNativeCapture={() => cameraInput.current?.click()}
        />
        <VoiceCapture
          isOpen={voiceOpen}
          onOpenChange={setVoiceOpen}
          onUseVoice={addVoice}
          onChooseAudio={() => audioInput.current?.click()}
        />
        <VideoCapture
          isOpen={videoOpen}
          onOpenChange={setVideoOpen}
          onUseVideo={(file, durationMs, hasAudio) =>
            addVideo(file, durationMs, hasAudio)
          }
          onChooseVideo={() => videoInput.current?.click()}
          onNativeCapture={() => nativeVideoInput.current?.click()}
        />
        <PlacePicker
          isOpen={placeOpen}
          onOpenChange={setPlaceOpen}
          selected={place}
          onSelect={(selectedPlace) => {
            setPlace(selectedPlace);
            setClientRequestId(crypto.randomUUID());
            setSaved(false);
            setError(null);
            setStageAnnouncement(
              `${selectedPlace.placeName} added to this unsaved Entry.`,
            );
          }}
          onRemove={() => {
            setPlace(null);
            setClientRequestId(crypto.randomUUID());
            setStageAnnouncement("Place removed from this unsaved Entry.");
          }}
        />
      </div>
      <p className="composer-help">
        Up to five private photos and either one voice note or one video.
        Selected media stays local until you send this Entry.
      </p>

      {video ? (
        <section
          className="video-draft-card"
          aria-labelledby="video-draft-heading"
        >
          <div className="voice-player-topline">
            <p id="video-draft-heading" className="voice-player-label">
              Video draft
            </p>
            <span>{formatVideoDuration(video.durationMs)}</span>
          </div>
          <video
            ref={videoPreview}
            className="video-review-player"
            src={video.previewUrl}
            controls
            playsInline
            preload="metadata"
            aria-label="Review selected private video draft"
          />
          <div className="video-review-meta">
            {video.hasAudio === null
              ? "Audio presence will be verified privately"
              : video.hasAudio
                ? "With audio"
                : "Silent"}
            {video.width && video.height
              ? ` · ${video.width}×${video.height}`
              : ""}
          </div>
          <div className="voice-draft-status" role="status">
            <span>{video.stage}</span>
            {video.stage === "Uploading" ? (
              <span>{video.progress}%</span>
            ) : null}
          </div>
          {video.stage === "Uploading" ? (
            <progress
              max={100}
              value={video.progress}
              aria-label="Video upload progress"
            />
          ) : null}
          {video.error ? (
            <p className="voice-player-error" role="alert">
              {video.error}
            </p>
          ) : null}
          <div className="voice-draft-actions">
            <Button
              className="button button-quiet min-h-11 px-3 text-xs"
              onPress={() => {
                if (!videoPreview.current) return;
                videoPreview.current.pause();
                videoPreview.current.currentTime = 0;
              }}
              isDisabled={busy}
            >
              Restart video preview
            </Button>
            <Button
              className="button button-quiet min-h-11 px-3 text-xs"
              onPress={removeVideo}
              isDisabled={busy}
            >
              Discard video
            </Button>
          </div>
        </section>
      ) : null}

      {audio ? (
        <section
          className="voice-draft-card"
          aria-labelledby="voice-draft-heading"
        >
          <div className="voice-player-topline">
            <p id="voice-draft-heading" className="voice-player-label">
              Voice-note draft
            </p>
            <span>{formatVoiceDuration(audio.durationMs)}</span>
          </div>
          <audio
            className="voice-draft-audio"
            src={audio.previewUrl}
            controls
            preload="metadata"
            aria-label="Review selected voice-note draft"
          />
          <div className="voice-draft-status" role="status">
            <span>{audio.stage}</span>
            {audio.stage === "Uploading" ? (
              <span>{audio.progress}%</span>
            ) : null}
          </div>
          {audio.stage === "Uploading" ? (
            <progress
              max={100}
              value={audio.progress}
              aria-label="Voice-note upload progress"
            />
          ) : null}
          {audio.error ? (
            <p className="voice-player-error" role="alert">
              {audio.error}
            </p>
          ) : null}
          <div className="voice-draft-actions">
            <Button
              className="button button-quiet min-h-11 px-3 text-xs"
              onPress={removeAudio}
              isDisabled={busy}
            >
              Discard voice note
            </Button>
          </div>
        </section>
      ) : null}

      {images.length > 0 ? (
        <div className="image-preview-shell">
          <div className="image-preview-summary">
            <p role="status">
              {images.length} of {maximumEntryImages}{" "}
              {images.length === 1 ? "photo" : "photos"} selected
            </p>
            <div>
              <Button
                className="button button-quiet min-h-11 px-3 text-xs"
                onPress={() => chooseInput.current?.click()}
                isDisabled={busy || images.length >= maximumEntryImages}
              >
                Add more
              </Button>
              <Button
                className="button button-quiet min-h-11 px-3 text-xs text-[var(--danger)]"
                onPress={clearImages}
                isDisabled={busy}
              >
                Clear all
              </Button>
            </div>
          </div>
          <ol className="image-preview-grid">
            {images.map((image, index) => (
              <li
                key={image.id}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3"
              >
                {/* Local object URL only; never persisted or uploaded as metadata. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={`Selected image ${index + 1}`}
                  className="aspect-video w-full rounded-lg object-cover"
                />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-bold">{image.file.name}</p>
                    <p className="text-[var(--muted)]">
                      {humanBytes(image.file.size)} · {image.stage}
                      {image.stage === "Uploading" ? ` ${image.progress}%` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs font-bold">
                    {index + 1}
                  </span>
                </div>
                {image.stage === "Uploading" ? (
                  <progress
                    className="mt-2 w-full"
                    max={100}
                    value={image.progress}
                    aria-label={`Upload progress for ${image.file.name}`}
                  />
                ) : null}
                {image.error ? (
                  <p className="mt-2 text-xs text-[var(--danger)]" role="alert">
                    {image.error}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs"
                    onPress={() => moveImage(index, -1)}
                    isDisabled={busy || index === 0}
                  >
                    Move earlier
                  </Button>
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs"
                    onPress={() => moveImage(index, 1)}
                    isDisabled={busy || index === images.length - 1}
                  >
                    Move later
                  </Button>
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs text-[var(--danger)]"
                    onPress={() => removeImage(image.id)}
                    isDisabled={busy}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--muted)]">
          <span
            className={remaining < 1000 ? "font-bold text-[var(--danger)]" : ""}
          >
            {remaining.toLocaleString("en")} characters left
          </span>
          <span className="hidden sm:inline"> · {shortcut} to save</span>
        </div>
        <div className="flex gap-2">
          {busy ? (
            <Button
              className="button button-secondary"
              onPress={() => void cancelUploads()}
              isDisabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
          <Button
            className="composer-send-button"
            onPress={() => void submit()}
            isDisabled={!valid || busy}
            aria-label={submitLabel}
          >
            <SendIcon className="size-5" />
            {busy
              ? "Working…"
              : hasFailedUploads
                ? "Retry failed uploads"
                : "Add to today"}
          </Button>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {saved ? "Entry added to your Odiina Feed." : stageAnnouncement}
      </div>
    </section>
  );
}
