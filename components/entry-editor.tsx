"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Label, TextArea, TextField } from "react-aria-components";
import type { Upload } from "tus-js-client";

import { CameraCapture } from "@/components/camera-capture";
import { VoiceCapture } from "@/components/voice-capture";
import { VoicePlayer } from "@/components/voice-player";
import type {
  EntryAudioMedia,
  EntryImageMedia,
  EntryMedia,
} from "@/lib/database/types";
import {
  processAudioDraft,
  type AudioDraft,
} from "@/lib/media/client-audio-upload";
import {
  abortImageUploads,
  processImageDraft,
  type ImageDraft,
} from "@/lib/media/client-upload";
import { formatVoiceDuration } from "@/lib/media/recorder";
import {
  acceptedAudioMimeTypes,
  acceptedImageMimeTypes,
  maximumAudioBytes,
  maximumAudioDurationMs,
  maximumEntryImages,
  maximumImageBytes,
  minimumAudioDurationMs,
} from "@/lib/validation/media";
import {
  localCivilDate,
  localTime,
  occurrenceFromLocalDateTime,
} from "@/lib/validation/timezone";

type EditorMediaItem =
  | { kind: "existing"; key: string; media: EntryImageMedia }
  | { kind: "draft"; key: string; draft: ImageDraft };

type EditorVoiceItem =
  | { kind: "existing"; media: EntryAudioMedia }
  | { kind: "draft"; draft: AudioDraft };

function initialEditorMedia(media: EntryMedia[]): EditorMediaItem[] {
  return media
    .filter((item) => item.media_kind === "image")
    .map((item) => ({
      kind: "existing",
      key: item.attachment_id,
      media: item,
    }));
}

function initialEditorVoice(media: EntryMedia[]): EditorVoiceItem | null {
  const voice = media.find((item) => item.media_kind === "audio");
  return voice ? { kind: "existing", media: voice } : null;
}

export function EntryEditor({
  entryId,
  currentRevisionId,
  initialBody,
  initialOccurredAt,
  initialOccurredTimezone,
  initialOccurredLocalDate,
  initialOccurredUtcOffsetMinutes,
  timezone,
  csrfToken,
  currentMedia,
}: {
  entryId: string;
  currentRevisionId: string;
  initialBody: string;
  initialOccurredAt: string;
  initialOccurredTimezone: string;
  initialOccurredLocalDate: string;
  initialOccurredUtcOffsetMinutes: number;
  timezone: string;
  csrfToken: string;
  currentMedia: EntryMedia[];
}) {
  const router = useRouter();
  const chooseInput = useRef<HTMLInputElement>(null);
  const nativeCameraInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const activeUploads = useRef(new Map<string, Upload>());
  const previewUrls = useRef(new Set<string>());
  const [body, setBody] = useState(initialBody);
  const [media, setMedia] = useState<EditorMediaItem[]>(() =>
    initialEditorMedia(currentMedia),
  );
  const [voice, setVoice] = useState<EditorVoiceItem | null>(() =>
    initialEditorVoice(currentMedia),
  );
  const initialOccurrenceDate = localCivilDate(
    new Date(initialOccurredAt),
    timezone,
  );
  const initialOccurrenceTime = localTime(
    new Date(initialOccurredAt),
    timezone,
  );
  const [occurrenceDate, setOccurrenceDate] = useState(initialOccurrenceDate);
  const [occurrenceTime, setOccurrenceTime] = useState(initialOccurrenceTime);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const remaining = 100_000 - Array.from(body).length;
  const occurrenceChanged =
    occurrenceDate !== initialOccurrenceDate ||
    occurrenceTime !== initialOccurrenceTime;
  const mediaIdentity = media
    .map((item) =>
      item.kind === "existing"
        ? item.media.attachment_id
        : `draft:${item.draft.id}`,
    )
    .join(",");
  const voiceIdentity = voice
    ? voice.kind === "existing"
      ? voice.media.attachment_id
      : `draft:${voice.draft.id}`
    : "";
  const initialImages = currentMedia.filter(
    (item) => item.media_kind === "image",
  );
  const initialVoice = currentMedia.find((item) => item.media_kind === "audio");
  const changed =
    body !== initialBody ||
    occurrenceChanged ||
    mediaIdentity !==
      initialImages.map((item) => item.attachment_id).join(",") ||
    voiceIdentity !== (initialVoice?.attachment_id ?? "");

  useEffect(() => {
    const uploads = activeUploads.current;
    const urls = previewUrls.current;
    return () => {
      void abortImageUploads(uploads);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!changed || busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, changed]);

  function updateDraft(id: string, update: Partial<ImageDraft>) {
    setMedia((current) =>
      current.map((item) =>
        item.kind === "draft" && item.draft.id === id
          ? { ...item, draft: { ...item.draft, ...update } }
          : item,
      ),
    );
  }

  function updateVoiceDraft(update: Partial<AudioDraft>) {
    setVoice((current) =>
      current?.kind === "draft"
        ? { ...current, draft: { ...current.draft, ...update } }
        : current,
    );
  }

  function addVoice(file: File, durationMs: number) {
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
    if (voice?.kind === "draft") {
      URL.revokeObjectURL(voice.draft.previewUrl);
      previewUrls.current.delete(voice.draft.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    setVoice({
      kind: "draft",
      draft: {
        id: crypto.randomUUID(),
        file,
        previewUrl,
        durationMs,
        progress: 0,
        stage: "Selected",
      },
    });
    setError(null);
    setAnnouncement(
      voice
        ? "A replacement voice note is selected for this unsaved revision. The historical note remains unchanged."
        : "A voice note is selected for this unsaved revision.",
    );
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

  function removeVoice() {
    if (voice?.kind === "draft") {
      URL.revokeObjectURL(voice.draft.previewUrl);
      previewUrls.current.delete(voice.draft.previewUrl);
    }
    setVoice(null);
    setAnnouncement("Voice note removed from this unsaved revision.");
  }

  function addFiles(files: File[]) {
    setError(null);
    const room = maximumEntryImages - media.length;
    if (files.length > room) {
      setError(`This revision can contain up to ${maximumEntryImages} photos.`);
    }
    const accepted: EditorMediaItem[] = [];
    for (const file of files.slice(0, room)) {
      if (
        !acceptedImageMimeTypes.includes(
          file.type as (typeof acceptedImageMimeTypes)[number],
        )
      ) {
        setError("Choose JPEG, PNG, or WebP photos only.");
        continue;
      }
      if (file.size < 1 || file.size > maximumImageBytes) {
        setError("Each photo must be no larger than 15 MiB.");
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      const id = crypto.randomUUID();
      previewUrls.current.add(previewUrl);
      accepted.push({
        kind: "draft",
        key: id,
        draft: {
          id,
          file,
          previewUrl,
          progress: 0,
          stage: "Selected",
        },
      });
    }
    setMedia((current) => [...current, ...accepted]);
    if (accepted.length > 0) {
      setAnnouncement(
        `${accepted.length} ${accepted.length === 1 ? "photo" : "photos"} added to this unsaved revision.`,
      );
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function moveMedia(index: number, delta: -1 | 1) {
    setMedia((current) => {
      const destination = index + delta;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setAnnouncement(
      `Photo moved ${delta < 0 ? "earlier" : "later"} in the revision.`,
    );
  }

  function removeMedia(index: number) {
    const target = media[index];
    if (target?.kind === "draft") {
      URL.revokeObjectURL(target.draft.previewUrl);
      previewUrls.current.delete(target.draft.previewUrl);
    }
    setMedia((current) => current.filter((_, position) => position !== index));
    setAnnouncement("Photo removed from this unsaved revision.");
  }

  async function save() {
    if (
      !changed ||
      (!body.trim() && media.length === 0 && !voice) ||
      remaining < 0 ||
      busy
    ) {
      return;
    }
    if (!navigator.onLine) {
      setError(
        "You are offline. This unsaved revision remains available here.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const occurrence = occurrenceChanged
        ? occurrenceFromLocalDateTime(occurrenceDate, occurrenceTime, timezone)
        : {
            occurredAt: initialOccurredAt,
            occurredLocalDate: initialOccurredLocalDate,
            occurredTimezone: initialOccurredTimezone,
            occurredUtcOffsetMinutes: initialOccurredUtcOffsetMinutes,
          };
      const attachmentIds: string[] = [];
      for (const item of media) {
        if (item.kind === "existing") {
          attachmentIds.push(item.media.attachment_id);
          continue;
        }
        try {
          const processed = await processImageDraft({
            image: item.draft,
            entryId,
            csrfToken,
            activeUploads: activeUploads.current,
            update: (update) => updateDraft(item.draft.id, update),
            announce: setAnnouncement,
          });
          attachmentIds.push(processed.attachmentId);
        } catch (caught) {
          const message =
            caught instanceof Error
              ? caught.message
              : "Odiina could not process this photo.";
          updateDraft(item.draft.id, { stage: "Failed", error: message });
          throw caught;
        }
      }
      if (voice?.kind === "existing") {
        attachmentIds.push(voice.media.attachment_id);
      } else if (voice?.kind === "draft") {
        try {
          const processed = await processAudioDraft({
            audio: voice.draft,
            entryId,
            csrfToken,
            activeUploads: activeUploads.current,
            update: updateVoiceDraft,
            announce: setAnnouncement,
          });
          attachmentIds.push(processed.attachmentId);
        } catch (caught) {
          const message =
            caught instanceof Error
              ? caught.message
              : "Odiina could not process this voice note.";
          updateVoiceDraft({ stage: "Failed", error: message });
          throw caught;
        }
      }
      const response = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          expectedCurrentRevisionId: currentRevisionId,
          bodyText: body,
          ...occurrence,
          changeReason: occurrenceChanged ? "occurrence_corrected" : "edited",
          attachmentIds,
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Could not save this revision.");
      }
      router.replace(`/entries/${entryId}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this revision.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="edit-entry-heading">
      <p className="eyebrow">New revision</p>
      <h2
        id="edit-entry-heading"
        className="m-0 text-xl font-bold tracking-[-0.03em]"
      >
        Edit Entry
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        Odiina preserves the current version. Text, time, photos and voice-note
        changes create a new immutable revision.
      </p>
      {error ? (
        <div className="form-error my-4" role="alert">
          {error}
        </div>
      ) : null}
      <TextField className="field mt-5" value={body} onChange={setBody}>
        <Label className="field-label">Entry text</Label>
        <TextArea
          id="edit-body"
          className="textarea min-h-56"
          maxLength={100_000}
        />
      </TextField>
      <fieldset className="occurrence-editor">
        <legend>When this happened</legend>
        <label>
          <span>Occurrence date</span>
          <input
            type="date"
            value={occurrenceDate}
            onChange={(event) => setOccurrenceDate(event.target.value)}
          />
        </label>
        <label>
          <span>Occurrence time</span>
          <input
            type="time"
            value={occurrenceTime}
            onChange={(event) => setOccurrenceTime(event.target.value)}
          />
        </label>
        <p>
          Saving a different occurrence time creates immutable correction
          evidence and may move this Entry to another Calendar day.
        </p>
      </fieldset>

      <section className="mt-5" aria-labelledby="edit-media-heading">
        <div className="image-preview-summary">
          <div>
            <h3 id="edit-media-heading" className="m-0 text-sm font-bold">
              Attached photos
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {media.length} of {maximumEntryImages}. New photos are uploaded
              only when you save.
            </p>
          </div>
          <div>
            <Button
              className="button button-secondary"
              onPress={() => chooseInput.current?.click()}
              isDisabled={busy || media.length >= maximumEntryImages}
            >
              Choose photos
            </Button>
            <Button
              className="button button-secondary"
              onPress={() => {
                setVoiceOpen(false);
                setCameraOpen(true);
              }}
              isDisabled={busy || media.length >= maximumEntryImages}
            >
              Take photo
            </Button>
          </div>
        </div>
        <input
          ref={chooseInput}
          className="sr-only"
          type="file"
          accept={acceptedImageMimeTypes.join(",")}
          multiple
          aria-label="Add photos to this revision"
          onChange={selectFiles}
          disabled={busy}
        />
        <input
          ref={nativeCameraInput}
          className="sr-only"
          type="file"
          accept={acceptedImageMimeTypes.join(",")}
          capture="environment"
          aria-label="Add a photo using the device camera"
          onChange={selectFiles}
          disabled={busy}
        />
        <CameraCapture
          isOpen={cameraOpen}
          onOpenChange={setCameraOpen}
          onUsePhoto={(file) => addFiles([file])}
          onChoosePhotos={() => chooseInput.current?.click()}
          onNativeCapture={() => nativeCameraInput.current?.click()}
        />

        {media.length > 0 ? (
          <ol className="image-preview-grid mt-3">
            {media.map((item, index) => {
              const draft = item.kind === "draft" ? item.draft : null;
              const source =
                item.kind === "draft"
                  ? item.draft.previewUrl
                  : `/api/media/${item.media.attachment_id}`;
              return (
                <li key={item.key} className="image-preview-card">
                  {/* Local preview or authenticated safe derivative only. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={source}
                    alt={`Photo ${index + 1} of ${media.length} in this revision`}
                    width={
                      item.kind === "existing" ? item.media.width : undefined
                    }
                    height={
                      item.kind === "existing" ? item.media.height : undefined
                    }
                  />
                  <div className="image-preview-meta">
                    <span>{index + 1}</span>
                    <p>
                      {draft
                        ? `${draft.stage}${draft.stage === "Uploading" ? ` ${draft.progress}%` : ""}`
                        : "Current photo"}
                    </p>
                  </div>
                  {draft?.stage === "Uploading" ? (
                    <progress
                      max={100}
                      value={draft.progress}
                      aria-label={`Upload progress for photo ${index + 1}`}
                    />
                  ) : null}
                  {draft?.error ? (
                    <p className="text-xs text-[var(--danger)]" role="alert">
                      {draft.error}
                    </p>
                  ) : null}
                  <div className="image-preview-actions">
                    <Button
                      className="button button-quiet"
                      isDisabled={busy || index === 0}
                      onPress={() => moveMedia(index, -1)}
                    >
                      Move earlier
                    </Button>
                    <Button
                      className="button button-quiet"
                      isDisabled={busy || index === media.length - 1}
                      onPress={() => moveMedia(index, 1)}
                    >
                      Move later
                    </Button>
                    <Button
                      className="button button-quiet text-[var(--danger)]"
                      isDisabled={busy}
                      onPress={() => removeMedia(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="empty-inline">No photos in this revision.</p>
        )}
      </section>

      <section
        className="voice-editor-section"
        aria-labelledby="edit-voice-heading"
      >
        <div className="image-preview-summary">
          <div>
            <h3 id="edit-voice-heading" className="m-0 text-sm font-bold">
              Private voice note
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              One per revision. Replacing or removing it preserves historical
              evidence.
            </p>
          </div>
          <div>
            <Button
              className="button button-secondary"
              onPress={() => {
                setCameraOpen(false);
                setVoiceOpen(true);
              }}
              isDisabled={busy}
            >
              {voice ? "Record replacement" : "Record voice note"}
            </Button>
            <Button
              className="button button-secondary"
              onPress={() => audioInput.current?.click()}
              isDisabled={busy}
            >
              {voice ? "Choose replacement" : "Choose audio file"}
            </Button>
          </div>
        </div>
        <input
          ref={audioInput}
          className="sr-only"
          type="file"
          accept={acceptedAudioMimeTypes.join(",")}
          aria-label={
            voice ? "Choose a replacement voice note" : "Choose a voice note"
          }
          onChange={(event) => void selectAudioFile(event)}
          disabled={busy}
        />
        <VoiceCapture
          isOpen={voiceOpen}
          onOpenChange={setVoiceOpen}
          onUseVoice={addVoice}
          onChooseAudio={() => audioInput.current?.click()}
        />
        {voice ? (
          <div className="voice-draft-card mt-3">
            {voice.kind === "existing" ? (
              <>
                <p className="voice-player-label">Current ready voice note</p>
                <VoicePlayer media={[voice.media]} />
              </>
            ) : (
              <>
                <div className="voice-player-topline">
                  <p className="voice-player-label">Unsaved voice-note draft</p>
                  <span>{formatVoiceDuration(voice.draft.durationMs)}</span>
                </div>
                <audio
                  className="voice-draft-audio"
                  src={voice.draft.previewUrl}
                  controls
                  preload="metadata"
                  aria-label="Review replacement voice-note draft"
                />
                <div className="voice-draft-status" role="status">
                  <span>{voice.draft.stage}</span>
                  {voice.draft.stage === "Uploading" ? (
                    <span>{voice.draft.progress}%</span>
                  ) : null}
                </div>
                {voice.draft.stage === "Uploading" ? (
                  <progress
                    max={100}
                    value={voice.draft.progress}
                    aria-label="Replacement voice-note upload progress"
                  />
                ) : null}
                {voice.draft.error ? (
                  <p className="voice-player-error" role="alert">
                    {voice.draft.error}
                  </p>
                ) : null}
              </>
            )}
            <Button
              className="button button-quiet mt-3 min-h-11 px-3 text-xs text-[var(--danger)]"
              onPress={removeVoice}
              isDisabled={busy}
            >
              Remove voice note from this revision
            </Button>
          </div>
        ) : (
          <p className="empty-inline">No voice note in this revision.</p>
        )}
      </section>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">
          {remaining.toLocaleString("en")} characters left
        </span>
        <div className="flex gap-2">
          <Button
            className="button button-secondary"
            onPress={() => router.back()}
            isDisabled={busy}
          >
            Cancel
          </Button>
          <Button
            className="button button-primary"
            onPress={() => void save()}
            isDisabled={
              !changed ||
              (!body.trim() && media.length === 0 && !voice) ||
              remaining < 0 ||
              busy
            }
          >
            {busy
              ? "Saving…"
              : media.some(
                    (item) =>
                      item.kind === "draft" && item.draft.stage === "Failed",
                  ) ||
                  (voice?.kind === "draft" && voice.draft.stage === "Failed")
                ? "Retry and save"
                : "Save revision"}
          </Button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </section>
  );
}
