"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { useRouter } from "next/navigation";

export function TrashEntryButton({
  entryId,
  csrfToken,
  onRemoved,
}: {
  entryId: string;
  csrfToken: string;
  onRemoved?: (entryId: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveToTrash(close: () => void) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/trash`, {
        method: "POST",
        headers: { "x-odiina-csrf": csrfToken },
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Could not move the Entry to Trash.");
      }
      onRemoved?.(entryId);
      close();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogTrigger>
      <Button className="button button-quiet" aria-label="Move Entry to Trash">
        Trash
      </Button>
      <ModalOverlay className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]">
        <Modal className="w-full max-w-md rounded-[1.15rem] bg-white p-6 shadow-2xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <>
                <Heading
                  slot="title"
                  className="m-0 text-xl font-bold tracking-[-0.025em]"
                >
                  Move this Entry to Trash?
                </Heading>
                <p className="mt-3 leading-7 text-[var(--muted)]">
                  It will leave your Feed and remain restorable for 30 days.
                </p>
                {error ? (
                  <div className="form-error mt-4" role="alert">
                    {error}
                  </div>
                ) : null}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <Button
                    className="button button-secondary"
                    onPress={close}
                    isDisabled={busy}
                  >
                    Keep Entry
                  </Button>
                  <Button
                    className="button button-danger"
                    onPress={() => void moveToTrash(close)}
                    isDisabled={busy}
                  >
                    {busy ? "Moving…" : "Move to Trash"}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
