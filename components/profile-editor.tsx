"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Upload } from "tus-js-client";

import type { PrivateProfile } from "@/lib/database/types";
import {
  acceptedImageMimeTypes,
  maximumImageBytes,
} from "@/lib/validation/media";
import {
  normalizeProfileHandle,
  profileBioMaximum,
  profileDisplayNameMaximum,
  profileHandleMaximum,
  profileHandleMinimum,
  reservedProfileHandles,
} from "@/lib/validation/profile";

type MediaRole = "avatar" | "banner";
type MediaState = {
  attachmentId: string | null;
  previewUrl: string | null;
  progress: number;
  stage:
    | "Idle"
    | "Selected"
    | "Uploading"
    | "Checking"
    | "Preparing"
    | "Ready"
    | "Failed";
  error: string | null;
};

type Authorization = {
  attachmentId: string;
  uploadEndpoint: string;
  uploadToken: string;
  bucketName: string;
  objectName: string;
};

const idleMedia = (attachmentId: string | null): MediaState => ({
  attachmentId,
  previewUrl: null,
  progress: 0,
  stage: "Idle",
  error: null,
});

export function ProfileEditor({
  profile,
  csrfToken,
}: {
  profile: PrivateProfile;
  csrfToken: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(() =>
    idleMedia(profile.avatar_attachment_id),
  );
  const [banner, setBanner] = useState(() =>
    idleMedia(profile.banner_attachment_id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const previewUrls = useRef(new Set<string>());
  const activeUploads = useRef(new Map<MediaRole, Upload>());

  const dirty = useMemo(
    () =>
      displayName !== profile.display_name ||
      handle !== profile.handle ||
      bio !== profile.bio ||
      avatar.attachmentId !== profile.avatar_attachment_id ||
      banner.attachmentId !== profile.banner_attachment_id,
    [
      avatar.attachmentId,
      banner.attachmentId,
      bio,
      displayName,
      handle,
      profile,
    ],
  );
  const processing = [avatar, banner].some((media) =>
    ["Selected", "Uploading", "Checking", "Preparing"].includes(media.stage),
  );

  useEffect(() => {
    const uploads = activeUploads.current;
    const urls = previewUrls.current;
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      for (const upload of uploads.values()) void upload.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [dirty]);

  function setMedia(role: MediaRole, update: Partial<MediaState>) {
    const setter = role === "avatar" ? setAvatar : setBanner;
    setter((current) => ({ ...current, ...update }));
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
    if (!response.ok)
      throw new Error(result.message ?? "The image could not be processed.");
    return result;
  }

  async function waitUntilReady(role: MediaRole, attachmentId: string) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(
        `/api/media/status?id=${encodeURIComponent(attachmentId)}`,
        {
          cache: "no-store",
        },
      );
      const result = (await response.json()) as {
        attachments?: {
          state: string;
          media_processing_jobs?: { stage: string }[];
        }[];
      };
      const status = result.attachments?.[0];
      if (!response.ok || !status)
        throw new Error("Image status is unavailable.");
      if (status.state === "accepted") {
        setMedia(role, { stage: "Ready", progress: 100, error: null });
        return;
      }
      if (["failed", "rejected", "deleted"].includes(status.state)) {
        throw new Error("The image did not pass private safety processing.");
      }
      const stage = status.media_processing_jobs?.[0]?.stage;
      setMedia(role, {
        stage: ["preparing", "promoting", "cleanup"].includes(stage ?? "")
          ? "Preparing"
          : "Checking",
        progress: 100,
      });
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("Image processing is taking longer than expected.");
  }

  async function upload(role: MediaRole, file: File) {
    const authorization = await jsonRequest<Authorization>(
      "/api/profile/media/authorize",
      {
        mediaRole: role,
        filename: file.name,
        declaredMime: file.type,
        byteCount: file.size,
      },
    );
    setMedia(role, {
      attachmentId: authorization.attachmentId,
      stage: "Uploading",
    });
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint: authorization.uploadEndpoint,
        headers: { "x-signature": authorization.uploadToken },
        metadata: {
          bucketName: authorization.bucketName,
          objectName: authorization.objectName,
          contentType: file.type,
          cacheControl: "0",
        },
        chunkSize: 6 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: false,
        uploadDataDuringCreation: false,
        onError: reject,
        onProgress: (uploaded, total) =>
          setMedia(role, { progress: Math.round((uploaded / total) * 100) }),
        onSuccess: () => resolve(),
      });
      activeUploads.current.set(role, upload);
      upload.start();
    }).finally(() => activeUploads.current.delete(role));
    setMedia(role, { stage: "Checking", progress: 100 });
    await jsonRequest("/api/media/finalize", {
      attachmentId: authorization.attachmentId,
    });
    await waitUntilReady(role, authorization.attachmentId);
  }

  async function chooseImage(
    role: MediaRole,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (
      !acceptedImageMimeTypes.includes(
        file.type as (typeof acceptedImageMimeTypes)[number],
      )
    ) {
      setMedia(role, {
        stage: "Failed",
        error: "Choose a JPEG, PNG, or WebP image.",
      });
      return;
    }
    if (file.size < 1 || file.size > maximumImageBytes) {
      setMedia(role, {
        stage: "Failed",
        error: "Choose an image no larger than 15 MiB.",
      });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    previewUrls.current.add(previewUrl);
    setMedia(role, { previewUrl, stage: "Selected", progress: 0, error: null });
    try {
      await upload(role, file);
    } catch (caught) {
      setMedia(role, {
        attachmentId:
          role === "avatar"
            ? profile.avatar_attachment_id
            : profile.banner_attachment_id,
        stage: "Failed",
        error:
          caught instanceof Error
            ? caught.message
            : "The image could not be processed.",
      });
    }
  }

  function removeMedia(role: MediaRole) {
    const upload = activeUploads.current.get(role);
    if (upload) void upload.abort(true);
    setMedia(role, {
      attachmentId: null,
      previewUrl: null,
      stage: "Idle",
      progress: 0,
      error: null,
    });
  }

  function validate() {
    const errors: Record<string, string[]> = {};
    const nameLength = Array.from(displayName.trim()).length;
    const normalizedHandle = normalizeProfileHandle(handle);
    if (nameLength < 1 || nameLength > profileDisplayNameMaximum) {
      errors.displayName = [`Enter 1–${profileDisplayNameMaximum} characters.`];
    }
    if (
      normalizedHandle.length < profileHandleMinimum ||
      normalizedHandle.length > profileHandleMaximum ||
      !/^[a-z][a-z0-9_]*$/.test(normalizedHandle)
    ) {
      errors.handle = [
        "Start with a letter and use 3–30 lowercase letters, numbers, or underscores.",
      ];
    } else if (reservedProfileHandles.has(normalizedHandle)) {
      errors.handle = ["That handle is unavailable. Choose another."];
    }
    if (Array.from(bio).length > profileBioMaximum) {
      errors.bio = [`Use ${profileBioMaximum} characters or fewer.`];
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    if (!validate() || processing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          displayName,
          handle,
          bio,
          avatarAttachmentId: avatar.attachmentId,
          bannerAttachmentId: banner.attachmentId,
        }),
      });
      const result = (await response.json()) as {
        message?: string;
        fieldErrors?: Record<string, string[]>;
      };
      if (!response.ok) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        throw new Error(
          result.message ?? "Odiina could not save your Profile.",
        );
      }
      router.replace("/profile?saved=1#profile-edit-action");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Odiina could not save your Profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  function cancel(event: React.MouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm("Discard your unsaved Profile changes?")) {
      event.preventDefault();
    }
  }

  const mediaControl = (role: MediaRole, media: MediaState) => {
    const hasExisting =
      role === "avatar"
        ? profile.avatar_attachment_id
        : profile.banner_attachment_id;
    const inputId = `${role}-upload`;
    return (
      <fieldset className="profile-media-editor">
        <legend>{role === "avatar" ? "Avatar" : "Banner"}</legend>
        <div className={`profile-media-preview profile-media-preview-${role}`}>
          {media.previewUrl ? (
            // Local previews never become durable media URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.previewUrl} alt={`${role} preview`} />
          ) : hasExisting && media.attachmentId ? (
            // Private same-origin delivery is deliberately not optimized into a public URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/profile/media/${role}?v=${encodeURIComponent(profile.updated_at)}`}
              alt={`Current ${role}`}
            />
          ) : (
            <span>
              {role === "avatar"
                ? "Your initials appear by default"
                : "Odiina gradient default"}
            </span>
          )}
        </div>
        <div className="profile-media-actions">
          <label className="button button-secondary" htmlFor={inputId}>
            {media.attachmentId ? `Replace ${role}` : `Choose ${role}`}
          </label>
          <input
            className="sr-only"
            id={inputId}
            type="file"
            accept={acceptedImageMimeTypes.join(",")}
            aria-describedby={`${role}-help ${role}-status`}
            onChange={(event) => void chooseImage(role, event)}
          />
          {media.attachmentId ? (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => removeMedia(role)}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p id={`${role}-help`} className="field-description">
          JPEG, PNG, or WebP up to 15 MiB. Odiina scans and prepares a private
          safe derivative.
        </p>
        <p
          id={`${role}-status`}
          className="profile-upload-status"
          aria-live="polite"
        >
          {media.stage === "Uploading"
            ? `Uploading ${media.progress}%`
            : media.stage === "Idle"
              ? ""
              : media.stage}
          {media.error ? `: ${media.error}` : ""}
        </p>
      </fieldset>
    );
  };

  return (
    <form
      className="profile-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="profile-edit-media-grid">
        {mediaControl("avatar", avatar)}
        {mediaControl("banner", banner)}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="display-name">
          Display name
        </label>
        <input
          className="input"
          id="display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={profileDisplayNameMaximum}
          aria-describedby="display-name-help display-name-error"
          aria-invalid={Boolean(fieldErrors.displayName)}
          autoComplete="name"
        />
        <p id="display-name-help" className="field-description">
          Required. Capitalization is kept exactly as you choose it.
        </p>
        <p id="display-name-error" className="field-error" role="alert">
          {fieldErrors.displayName?.[0]}
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="profile-handle">
          Handle
        </label>
        <div className="handle-input">
          <span aria-hidden="true">@</span>
          <input
            id="profile-handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            maxLength={profileHandleMaximum}
            aria-describedby="handle-help handle-error"
            aria-invalid={Boolean(fieldErrors.handle)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <p id="handle-help" className="field-description">
          3–30 characters. Stored in lowercase; start with a letter and use
          letters, numbers, or underscores.
        </p>
        <p id="handle-error" className="field-error" role="alert">
          {fieldErrors.handle?.[0]}
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="profile-bio">
          Bio
        </label>
        <textarea
          className="textarea"
          id="profile-bio"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={profileBioMaximum}
          rows={5}
          aria-describedby="bio-count bio-error"
          aria-invalid={Boolean(fieldErrors.bio)}
        />
        <p id="bio-count" className="field-description">
          {Array.from(bio).length} of {profileBioMaximum} characters. Line
          breaks are preserved.
        </p>
        <p id="bio-error" className="field-error" role="alert">
          {fieldErrors.bio?.[0]}
        </p>
      </div>
      <div className="profile-edit-actions">
        <button
          className="button button-primary"
          type="submit"
          disabled={busy || processing}
        >
          {busy
            ? "Saving…"
            : processing
              ? "Waiting for images…"
              : "Save Profile"}
        </button>
        <Link
          className="button button-secondary"
          href="/profile#profile-edit-action"
          onClick={cancel}
        >
          Cancel
        </Link>
        <span className="field-description" aria-live="polite">
          {dirty ? "Unsaved changes" : "No unsaved changes"}
        </span>
      </div>
    </form>
  );
}
