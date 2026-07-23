"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteAiArtifactButton({
  kind,
  artifactId,
  csrfToken,
}: {
  kind: "insight" | "transcript";
  artifactId: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    const response = await fetch(
      `/api/${kind === "insight" ? "insights" : "transcripts"}/${artifactId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          kind,
          artifactId,
          confirmation: "DELETE AI-DERIVED DATA",
        }),
      },
    );
    if (!response.ok) {
      const result = (await response.json()) as { message?: string };
      setError(result.message ?? "Deletion failed.");
      return;
    }
    if (kind === "insight") router.replace("/insights");
    else router.refresh();
  }
  if (!confirming)
    return (
      <button
        className="button button-danger"
        type="button"
        onClick={() => setConfirming(true)}
      >
        Delete {kind}
      </button>
    );
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        Delete this AI-derived {kind}? Your original Entry and media remain
        unchanged.
      </p>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="flex gap-3">
        <button
          className="button button-danger"
          type="button"
          onClick={() => void remove()}
        >
          Confirm deletion
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setConfirming(false)}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
