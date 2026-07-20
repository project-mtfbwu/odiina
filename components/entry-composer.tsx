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
import { Upload } from "tus-js-client";

import {
  CameraIcon,
  ImageIcon,
  LocationIcon,
  MicrophoneIcon,
  PlusIcon,
  SendIcon,
  VideoIcon,
} from "@/components/icons";
import {
  acceptedImageMimeTypes,
  maximumEntryImages,
  maximumImageBytes,
} from "@/lib/validation/media";
import { localCivilDate, utcOffsetMinutes } from "@/lib/validation/timezone";

const maximumLength = 100_000;
const tusChunkSize = 6 * 1024 * 1024;

type UploadStage =
  "Selected" | "Uploading" | "Checking" | "Preparing" | "Ready" | "Failed";

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  stage: UploadStage;
  attachmentId?: string;
  error?: string;
};

type UploadAuthorization = {
  entryId: string;
  attachmentId: string;
  uploadEndpoint: string;
  uploadToken: string;
  bucketName: string;
  objectName: string;
};

function humanBytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function EntryComposer({
  csrfToken,
  timezone,
}: {
  csrfToken: string;
  timezone: string;
}) {
  const chooseInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const activeUploads = useRef(new Map<string, Upload>());
  const previewUrls = useRef(new Set<string>());
  const [body, setBody] = useState("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [clientRequestId, setClientRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stageAnnouncement, setStageAnnouncement] = useState("");
  const remaining = maximumLength - Array.from(body).length;
  const valid = (body.trim().length > 0 || images.length > 0) && remaining >= 0;
  const hasFailedUploads = images.some((image) => image.stage === "Failed");
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
      for (const upload of uploads.values()) void upload.abort();
    };
  }, []);

  function updateImage(id: string, update: Partial<SelectedImage>) {
    setImages((current) =>
      current.map((image) =>
        image.id === id ? { ...image, ...update } : image,
      ),
    );
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError(null);
    const room = maximumEntryImages - images.length;
    if (chosen.length > room) {
      setError(`You can attach up to ${maximumEntryImages} images.`);
    }
    const accepted: SelectedImage[] = [];
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

  function uploadWithTus(
    image: SelectedImage,
    authorization: UploadAuthorization,
  ) {
    return new Promise<void>((resolve, reject) => {
      const upload = new Upload(image.file, {
        endpoint: authorization.uploadEndpoint,
        headers: { "x-signature": authorization.uploadToken },
        metadata: {
          bucketName: authorization.bucketName,
          objectName: authorization.objectName,
          contentType: image.file.type,
          cacheControl: "0",
        },
        chunkSize: tusChunkSize,
        retryDelays: [0, 1000, 3000, 5000],
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: false,
        uploadDataDuringCreation: false,
        onError: reject,
        onProgress: (uploaded, total) => {
          updateImage(image.id, {
            progress: Math.round((uploaded / total) * 100),
          });
        },
        onSuccess: () => resolve(),
      });
      activeUploads.current.set(image.id, upload);
      upload.start();
    }).finally(() => activeUploads.current.delete(image.id));
  }

  async function waitUntilProcessed(image: SelectedImage) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(
        `/api/media/status?id=${encodeURIComponent(image.attachmentId ?? "")}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        attachments?: {
          state: string;
          error_code: string | null;
          media_processing_jobs?: {
            stage: string;
            last_error_code: string | null;
          }[];
        }[];
      };
      const status = result.attachments?.[0];
      if (!response.ok || !status) throw new Error("Image status unavailable.");
      const workerStage = status.media_processing_jobs?.[0]?.stage;
      const namedStage: UploadStage =
        workerStage === "preparing" ||
        workerStage === "promoting" ||
        workerStage === "cleanup"
          ? "Preparing"
          : "Checking";
      if (status.state === "accepted") {
        updateImage(image.id, { stage: "Ready", progress: 100 });
        setStageAnnouncement(`${image.file.name} is ready.`);
        return;
      }
      if (["failed", "rejected", "deleted"].includes(status.state)) {
        throw new Error("The image did not pass private safety processing.");
      }
      updateImage(image.id, { stage: namedStage, progress: 100 });
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Image processing is taking longer than expected.");
  }

  async function processImage(
    image: SelectedImage,
    draftEntryId: string | null,
  ) {
    updateImage(image.id, {
      stage: "Uploading",
      progress: 0,
      error: undefined,
    });
    setStageAnnouncement(`${image.file.name} is uploading.`);
    const authorization = await jsonRequest<UploadAuthorization>(
      "/api/media/authorize",
      {
        entryId: draftEntryId,
        filename: image.file.name,
        declaredMime: image.file.type,
        byteCount: image.file.size,
      },
    );
    image.attachmentId = authorization.attachmentId;
    updateImage(image.id, { attachmentId: authorization.attachmentId });
    await uploadWithTus(image, authorization);
    updateImage(image.id, { stage: "Checking", progress: 100 });
    setStageAnnouncement(`${image.file.name} is being checked privately.`);
    await jsonRequest("/api/media/finalize", {
      attachmentId: authorization.attachmentId,
    });
    await waitUntilProcessed({
      ...image,
      attachmentId: authorization.attachmentId,
    });
    return authorization.entryId;
  }

  async function cancelUploads() {
    setCancelling(true);
    for (const upload of activeUploads.current.values())
      await upload.abort(true);
    const ids = images.flatMap((image) =>
      image.attachmentId ? [image.attachmentId] : [],
    );
    await Promise.allSettled(
      ids.map((attachmentId) =>
        jsonRequest("/api/media/cancel", { attachmentId }),
      ),
    );
    setImages((current) =>
      current.map((image) => ({
        ...image,
        stage: "Failed",
        error: "Upload cancelled.",
      })),
    );
    setBusy(false);
    setCancelling(false);
    setStageAnnouncement("Image upload cancelled.");
  }

  async function submit() {
    if (!valid || busy) return;
    if (!navigator.onLine) {
      setError(
        "You are offline. Your text and selected photos remain here; reconnect to save.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const occurredAt = new Date();
    try {
      if (images.length === 0) {
        await jsonRequest("/api/entries", {
          clientRequestId,
          bodyText: body,
          occurredAt: occurredAt.toISOString(),
          occurredTimezone: timezone,
          occurredLocalDate: localCivilDate(occurredAt, timezone),
          occurredUtcOffsetMinutes: utcOffsetMinutes(occurredAt, timezone),
        });
      } else {
        let draftEntryId: string | null = null;
        for (const image of images) {
          try {
            draftEntryId = await processImage(image, draftEntryId);
          } catch (caught) {
            const message =
              caught instanceof Error
                ? caught.message
                : "Odiina could not process this image.";
            updateImage(image.id, { stage: "Failed", error: message });
            throw caught;
          }
        }
        const attachmentIds = images.flatMap((image) =>
          image.attachmentId ? [image.attachmentId] : [],
        );
        await jsonRequest("/api/media/activate", {
          entryId: draftEntryId,
          bodyText: body,
          attachmentIds,
          occurredAt: occurredAt.toISOString(),
          occurredTimezone: timezone,
          occurredLocalDate: localCivilDate(occurredAt, timezone),
          occurredUtcOffsetMinutes: utcOffsetMinutes(occurredAt, timezone),
        });
      }
      for (const image of images) {
        URL.revokeObjectURL(image.previewUrl);
        previewUrls.current.delete(image.previewUrl);
      }
      setImages([]);
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
    <section className="composer-shell" aria-labelledby="capture-heading">
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
        <Label className="sr-only">Entry text (optional with photos)</Label>
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
              <MenuItem onAction={() => cameraInput.current?.click()}>
                <CameraIcon className="size-5" /> Take photo
              </MenuItem>
              <MenuItem isDisabled>
                <VideoIcon className="size-5" /> Choose video
                <span>Stage F</span>
              </MenuItem>
              <MenuItem isDisabled>
                <VideoIcon className="size-5" /> Record video
                <span>Stage F</span>
              </MenuItem>
              <MenuItem isDisabled>
                <LocationIcon className="size-5" /> Add location
                <span>Stage G</span>
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
        <Button
          className="composer-icon-button"
          onPress={() => cameraInput.current?.click()}
          isDisabled={busy || images.length >= maximumEntryImages}
          aria-label="Take a photo"
        >
          <CameraIcon className="size-5" />
        </Button>
        <Button
          className="composer-icon-button"
          isDisabled
          aria-label="Voice note recording — available in MVP stage E"
        >
          <MicrophoneIcon className="size-5" />
        </Button>
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
      </div>
      <p className="composer-help">
        Up to five JPEG, PNG, or WebP images, 15 MiB each. Odiina checks and
        prepares images privately before showing them.
      </p>

      {images.length > 0 ? (
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
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
            aria-label="Add to today"
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
