import { Upload } from "tus-js-client";

const tusChunkSize = 6 * 1024 * 1024;

export type VideoUploadStage =
  | "Selected"
  | "Uploading"
  | "Scanning"
  | "Validating"
  | "Transcoding"
  | "Poster"
  | "Activating"
  | "Ready"
  | "Failed";

export type VideoDraft = {
  id: string;
  file: File;
  previewUrl: string;
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean | null;
  progress: number;
  stage: VideoUploadStage;
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
    headers: { "content-type": "application/json", "x-odiina-csrf": csrfToken },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(result.message ?? "Odiina could not process the video.");
  }
  return result;
}

function uploadWithTus(
  video: VideoDraft,
  authorization: UploadAuthorization,
  activeUploads: Map<string, Upload>,
  update: (update: Partial<VideoDraft>) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(video.file, {
      endpoint: authorization.uploadEndpoint,
      headers: { "x-signature": authorization.uploadToken },
      metadata: {
        bucketName: authorization.bucketName,
        objectName: authorization.objectName,
        contentType: video.file.type,
        cacheControl: "0",
      },
      chunkSize: tusChunkSize,
      retryDelays: [0, 1000, 3000, 5000, 10_000],
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: false,
      uploadDataDuringCreation: false,
      onError: reject,
      onProgress: (uploaded, total) =>
        update({ progress: Math.round((uploaded / total) * 100) }),
      onSuccess: () => resolve(),
    });
    activeUploads.set(video.id, upload);
    upload.start();
  }).finally(() => activeUploads.delete(video.id));
}

function statusStage(workerStage?: string): VideoUploadStage {
  if (workerStage === "scanning") return "Scanning";
  if (["checking", "validating", "preparing"].includes(workerStage ?? "")) {
    return "Validating";
  }
  if (workerStage === "transcoding") return "Transcoding";
  if (workerStage === "poster") return "Poster";
  if (["promoting", "cleanup"].includes(workerStage ?? "")) return "Activating";
  return "Validating";
}

async function waitUntilProcessed(
  attachmentId: string,
  update: (update: Partial<VideoDraft>) => void,
) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await fetch(
      `/api/media/status?id=${encodeURIComponent(attachmentId)}`,
      {
        cache: "no-store",
      },
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
      throw new Error("Video status is unavailable.");
    if (status.state === "accepted") {
      update({ stage: "Ready", progress: 100, error: undefined });
      return;
    }
    if (["failed", "rejected", "deleted"].includes(status.state)) {
      throw new Error("The video did not pass private safety processing.");
    }
    update({
      stage: statusStage(status.media_processing_jobs?.[0]?.stage),
      progress: 100,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Video processing is taking longer than expected.");
}

export async function processVideoDraft({
  video,
  entryId,
  csrfToken,
  activeUploads,
  update,
  announce,
}: {
  video: VideoDraft;
  entryId: string | null;
  csrfToken: string;
  activeUploads: Map<string, Upload>;
  update: (update: Partial<VideoDraft>) => void;
  announce: (message: string) => void;
}): Promise<{ entryId: string; attachmentId: string }> {
  if (video.stage === "Ready" && video.entryId && video.attachmentId) {
    return { entryId: video.entryId, attachmentId: video.attachmentId };
  }
  if (video.attachmentId) {
    await jsonRequest(csrfToken, "/api/media/cancel", {
      attachmentId: video.attachmentId,
    }).catch(() => {});
  }
  update({
    stage: "Uploading",
    progress: 0,
    attachmentId: undefined,
    error: undefined,
  });
  announce("Your video is uploading privately.");
  const authorization = await jsonRequest<UploadAuthorization>(
    csrfToken,
    "/api/media/video/authorize",
    {
      entryId,
      filename: video.file.name,
      declaredMime: video.file.type,
      byteCount: video.file.size,
    },
  );
  update({
    attachmentId: authorization.attachmentId,
    entryId: authorization.entryId,
  });
  await uploadWithTus(video, authorization, activeUploads, update);
  update({ stage: "Scanning", progress: 100 });
  announce("Your video is being scanned and validated privately.");
  await jsonRequest(csrfToken, "/api/media/video/finalize", {
    attachmentId: authorization.attachmentId,
  });
  await waitUntilProcessed(authorization.attachmentId, update);
  announce("Your video is ready.");
  return {
    entryId: authorization.entryId,
    attachmentId: authorization.attachmentId,
  };
}

export async function abortVideoUploads(
  uploads: Map<string, Upload>,
): Promise<void> {
  await Promise.allSettled(
    Array.from(uploads.values(), (upload) => upload.abort(true)),
  );
  uploads.clear();
}
