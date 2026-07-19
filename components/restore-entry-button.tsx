"use client";

import { useState } from "react";
import { Button } from "react-aria-components";
import { useRouter } from "next/navigation";

export function RestoreEntryButton({
  entryId,
  csrfToken,
  onRestored,
}: {
  entryId: string;
  csrfToken: string;
  onRestored?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/restore`, {
        method: "POST",
        headers: { "x-odiina-csrf": csrfToken },
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Could not restore this Entry.");
      }
      onRestored?.();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        className="button button-secondary"
        onPress={() => void restore()}
        isDisabled={busy}
      >
        {busy ? "Restoring…" : "Restore Entry"}
      </Button>
      {error ? (
        <p className="mt-2 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
