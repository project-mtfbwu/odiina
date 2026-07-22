import { Upload } from "tus-js-client";

const tusChunkSize = 6 * 1024 * 1024;

export type AudioUploadStage =
  | "Selected"
  | "Uploading"
  | "Scanning"
  | "Validating"
  | "Processing"
  | "Waveform"
  | "Ready"
  | "Failed";

export type AudioDraft = {
  id: string;
  file: File;
  previewUrl: string;
  durationMs: number;
  progress: number;
  stage: AudioUploadStage;
  attachmentId?: string;
  entryId?: string;
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

async function jsonRequest<T>(
  csrfToken: string,
  url: string,
  payload: object,
): Promise<T> {
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
    throw new Error(
      result.message ?? "Odiina could not process the voice note.",
    );
  }
  return result;
}

function uploadWithTus(
  audio: AudioDraft,
  authorization: UploadAuthorization,
  activeUploads: Map<string, Upload>,
  update: (update: Partial<AudioDraft>) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(audio.file, {
      endpoint: authorization.uploadEndpoint,
      headers: { "x-signature": authorization.uploadToken },
      metadata: {
        bucketName: authorization.bucketName,
        objectName: authorization.objectName,
        contentType: audio.file.type,
        cacheControl: "0",
      },
      chunkSize: tusChunkSize,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      uploadDataDuringCreation: false,
      onError: reject,
      onProgress: (uploaded, total) => {
        update({ progress: Math.round((uploaded / total) * 100) });
      },
      onSuccess: () => resolve(),
    });
    activeUploads.set(audio.id, upload);
    upload.start();
  }).finally(() => activeUploads.delete(audio.id));
}

function statusStage(workerStage?: string): AudioUploadStage {
  if (workerStage === "scanning") return "Scanning";
  if (workerStage === "validating" || workerStage === "checking") {
    return "Validating";
  }
  if (
    ["preparing", "transcoding", "promoting", "cleanup"].includes(
      workerStage ?? "",
    )
  ) {
    return "Processing";
  }
  if (workerStage === "waveform") return "Waveform";
  return "Validating";
}

async function waitUntilProcessed(
  attachmentId: string,
  update: (update: Partial<AudioDraft>) => void,
) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await fetch(
      `/api/media/status?id=${encodeURIComponent(attachmentId)}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as {
      attachments?: {
        state: string;
        error_code?: string | null;
        media_processing_jobs?: {
          stage: string;
          last_error_code?: string | null;
        }[];
      }[];
    };
    const status = result.attachments?.[0];
    if (response.status === 401)
      throw new Error("Your session expired. Sign in again.");
    if (!response.ok || !status)
      throw new Error("Voice-note status is unavailable.");
    if (status.state === "accepted") {
      update({ stage: "Ready", progress: 100, error: undefined });
      return;
    }
    if (["failed", "rejected", "deleted"].includes(status.state)) {
      throw new Error("The voice note did not pass private safety processing.");
    }
    update({
      stage: statusStage(status.media_processing_jobs?.[0]?.stage),
      progress: 100,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Voice-note processing is taking longer than expected.");
}

export async function processAudioDraft({
  audio,
  entryId,
  csrfToken,
  activeUploads,
  update,
  announce,
}: {
  audio: AudioDraft;
  entryId: string | null;
  csrfToken: string;
  activeUploads: Map<string, Upload>;
  update: (update: Partial<AudioDraft>) => void;
  announce: (message: string) => void;
}): Promise<{ entryId: string; attachmentId: string }> {
  if (audio.stage === "Ready" && audio.entryId && audio.attachmentId) {
    return { entryId: audio.entryId, attachmentId: audio.attachmentId };
  }
  if (audio.attachmentId) {
    await jsonRequest(csrfToken, "/api/media/cancel", {
      attachmentId: audio.attachmentId,
    }).catch(() => {});
  }
  update({
    stage: "Uploading",
    progress: 0,
    attachmentId: undefined,
    error: undefined,
  });
  announce("Your voice note is uploading privately.");
  const authorization = await jsonRequest<UploadAuthorization>(
    csrfToken,
    "/api/media/audio/authorize",
    {
      entryId,
      filename: audio.file.name,
      declaredMime: audio.file.type,
      byteCount: audio.file.size,
    },
  );
  update({
    attachmentId: authorization.attachmentId,
    entryId: authorization.entryId,
  });
  await uploadWithTus(audio, authorization, activeUploads, update);
  update({ stage: "Scanning", progress: 100 });
  announce("Your voice note is being scanned and validated privately.");
  await jsonRequest(csrfToken, "/api/media/audio/finalize", {
    attachmentId: authorization.attachmentId,
  });
  await waitUntilProcessed(authorization.attachmentId, update);
  announce("Your voice note is ready.");
  return {
    entryId: authorization.entryId,
    attachmentId: authorization.attachmentId,
  };
}
