"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

export function PlaceRedactionButton({
  entryId,
  csrfToken,
}: {
  entryId: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function redact(close: () => void) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/entries/${entryId}/place/redact`, {
        method: "POST",
        headers: { "x-odiina-csrf": csrfToken },
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(
          result.message ?? "Could not remove this place history.",
        );
      }
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
      <Button className="button button-danger">
        Remove place from all revisions
      </Button>
      <ModalOverlay className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]">
        <Modal className="w-full max-w-md rounded-[1.15rem] bg-[var(--surface)] p-6 text-[var(--ink)] shadow-2xl">
          <Dialog className="outline-none">
            {({ close }) => (
              <>
                <Heading slot="title" className="m-0 text-xl font-bold">
                  Remove all place history?
                </Heading>
                <p className="mt-3 leading-7 text-[var(--muted)]">
                  This permanently clears the place label, area, address,
                  coordinates and provider identifiers from every revision of
                  this Entry. The revision record itself remains for integrity.
                </p>
                <p className="font-bold text-[var(--danger)]">
                  This cannot be undone.
                </p>
                {error ? (
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                ) : null}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <Button
                    className="button button-secondary"
                    onPress={close}
                    isDisabled={busy}
                  >
                    Keep place history
                  </Button>
                  <Button
                    className="button button-danger"
                    onPress={() => void redact(close)}
                    isDisabled={busy}
                  >
                    {busy ? "Removing…" : "Remove permanently"}
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
