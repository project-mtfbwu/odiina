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

import type { EntryMedia as EntryMediaItem } from "@/lib/database/types";

export function EntryMedia({
  media,
  trash = false,
  compact = false,
}: {
  media: EntryMediaItem[];
  trash?: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const images = media.filter((item) => item.media_kind === "image");
  if (images.length === 0) return null;
  return (
    <div
      className={`entry-media-grid ${images.length > 1 ? "entry-media-multiple" : "entry-media-single"}`}
      aria-label={`${images.length} attached ${images.length === 1 ? "image" : "images"}`}
    >
      {images.map((item, index) =>
        failed.has(item.attachment_id) ? (
          <div
            key={item.attachment_id}
            className="flex aspect-video min-h-28 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 text-center text-sm text-[var(--muted)]"
            role="img"
            aria-label={`Attached image ${index + 1} could not be loaded`}
          >
            Image unavailable
          </div>
        ) : (
          <DialogTrigger key={item.attachment_id}>
            <Button
              className={`entry-media-inspect ${compact ? "entry-media-compact" : ""}`}
              aria-label={`Inspect photo ${index + 1} of ${images.length}`}
            >
              {/* The authenticated media route always returns a stripped JPEG. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${item.attachment_id}${trash ? "?scope=trash" : ""}`}
                alt={`Photo attached to Entry, ${index + 1} of ${images.length}`}
                width={item.width}
                height={item.height}
                loading="lazy"
                onError={() =>
                  setFailed((current) =>
                    new Set(current).add(item.attachment_id),
                  )
                }
              />
            </Button>
            <ModalOverlay className="photo-lightbox-overlay" isDismissable>
              <Modal className="photo-lightbox-modal">
                <Dialog className="photo-lightbox-dialog">
                  {({ close }) => (
                    <>
                      <Heading slot="title" className="sr-only">
                        Photo {index + 1} of {images.length}
                      </Heading>
                      {/* Safe display derivative; originals are never delivered. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/media/${item.attachment_id}${trash ? "?scope=trash" : ""}`}
                        alt={`Photo attached to Entry, ${index + 1} of ${images.length}`}
                        width={item.width}
                        height={item.height}
                      />
                      <div className="photo-lightbox-footer">
                        <p>
                          Photo {index + 1} of {images.length} · Private safe
                          derivative
                        </p>
                        <Button
                          className="button button-secondary"
                          onPress={close}
                        >
                          Close photo
                        </Button>
                      </div>
                    </>
                  )}
                </Dialog>
              </Modal>
            </ModalOverlay>
          </DialogTrigger>
        ),
      )}
    </div>
  );
}
