"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Label, TextArea, TextField } from "react-aria-components";
import type { Upload } from "tus-js-client";

import { CameraCapture } from "@/components/camera-capture";
import type { EntryMedia } from "@/lib/database/types";
import {
  abortImageUploads,
  processImageDraft,
  type ImageDraft,
} from "@/lib/media/client-upload";
import {
  acceptedImageMimeTypes,
  maximumEntryImages,
  maximumImageBytes,
} from "@/lib/validation/media";
import {
  localCivilDate,
  localTime,
  occurrenceFromLocalDateTime,
} from "@/lib/validation/timezone";

type EditorMediaItem =
  | { kind: "existing"; key: string; media: EntryMedia }
  | { kind: "draft"; key: string; draft: ImageDraft };

function initialEditorMedia(media: EntryMedia[]): EditorMediaItem[] {
  return media.map((item) => ({
    kind: "existing",
    key: item.attachment_id,
    media: item,
  }));
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
  const activeUploads = useRef(new Map<string, Upload>());
  const previewUrls = useRef(new Set<string>());
  const [body, setBody] = useState(initialBody);
  const [media, setMedia] = useState<EditorMediaItem[]>(() =>
    initialEditorMedia(currentMedia),
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
  const changed =
    body !== initialBody ||
    occurrenceChanged ||
    mediaIdentity !== currentMedia.map((item) => item.attachment_id).join(",");

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
      (!body.trim() && media.length === 0) ||
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
        Odiina preserves the current version. Text, time, photo order, additions
        and removals create a new immutable revision.
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
              onPress={() => setCameraOpen(true)}
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
              (!body.trim() && media.length === 0) ||
              remaining < 0 ||
              busy
            }
          >
            {busy
              ? "Saving…"
              : media.some(
                    (item) =>
                      item.kind === "draft" && item.draft.stage === "Failed",
                  )
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
