import { Upload } from "tus-js-client";

const tusChunkSize = 6 * 1024 * 1024;

export type ImageUploadStage =
  "Selected" | "Uploading" | "Checking" | "Preparing" | "Ready" | "Failed";

export type ImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  stage: ImageUploadStage;
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
    throw new Error(result.message ?? "Odiina could not process the photo.");
  }
  return result;
}

export async function cancelImageAttempt(
  csrfToken: string,
  attachmentId: string,
): Promise<void> {
  await jsonRequest(csrfToken, "/api/media/cancel", { attachmentId });
}

function uploadWithTus(
  image: ImageDraft,
  authorization: UploadAuthorization,
  activeUploads: Map<string, Upload>,
  update: (update: Partial<ImageDraft>) => void,
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
        update({ progress: Math.round((uploaded / total) * 100) });
      },
      onSuccess: () => resolve(),
    });
    activeUploads.set(image.id, upload);
    upload.start();
  }).finally(() => activeUploads.delete(image.id));
}

async function waitUntilProcessed(
  csrfToken: string,
  attachmentId: string,
  update: (update: Partial<ImageDraft>) => void,
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(
      `/api/media/status?id=${encodeURIComponent(attachmentId)}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as {
      attachments?: {
        state: string;
        media_processing_jobs?: { stage: string }[];
      }[];
    };
    const status = result.attachments?.[0];
    if (!response.ok || !status) throw new Error("Photo status unavailable.");
    const workerStage = status.media_processing_jobs?.[0]?.stage;
    const stage: ImageUploadStage = [
      "preparing",
      "promoting",
      "cleanup",
    ].includes(workerStage ?? "")
      ? "Preparing"
      : "Checking";
    if (status.state === "accepted") {
      update({ stage: "Ready", progress: 100, error: undefined });
      return;
    }
    if (["failed", "rejected", "deleted"].includes(status.state)) {
      throw new Error("The photo did not pass private safety processing.");
    }
    update({ stage, progress: 100 });
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Photo processing is taking longer than expected.");
}

export async function processImageDraft({
  image,
  entryId,
  csrfToken,
  activeUploads,
  update,
  announce,
}: {
  image: ImageDraft;
  entryId: string | null;
  csrfToken: string;
  activeUploads: Map<string, Upload>;
  update: (update: Partial<ImageDraft>) => void;
  announce: (message: string) => void;
}): Promise<{ entryId: string; attachmentId: string }> {
  if (image.stage === "Ready" && image.entryId && image.attachmentId) {
    return { entryId: image.entryId, attachmentId: image.attachmentId };
  }

  if (image.attachmentId) {
    await cancelImageAttempt(csrfToken, image.attachmentId).catch(() => {});
  }
  update({
    stage: "Uploading",
    progress: 0,
    attachmentId: undefined,
    error: undefined,
  });
  announce("A selected photo is uploading.");
  const authorization = await jsonRequest<UploadAuthorization>(
    csrfToken,
    "/api/media/authorize",
    {
      entryId,
      filename: image.file.name,
      declaredMime: image.file.type,
      byteCount: image.file.size,
    },
  );
  update({
    attachmentId: authorization.attachmentId,
    entryId: authorization.entryId,
  });
  await uploadWithTus(image, authorization, activeUploads, update);
  update({ stage: "Checking", progress: 100 });
  announce("A selected photo is being checked privately.");
  await jsonRequest(csrfToken, "/api/media/finalize", {
    attachmentId: authorization.attachmentId,
  });
  await waitUntilProcessed(csrfToken, authorization.attachmentId, update);
  announce("A selected photo is ready.");
  return {
    entryId: authorization.entryId,
    attachmentId: authorization.attachmentId,
  };
}

export async function abortImageUploads(
  uploads: Map<string, Upload>,
): Promise<void> {
  await Promise.allSettled(
    Array.from(uploads.values(), (upload) => upload.abort(true)),
  );
  uploads.clear();
}
