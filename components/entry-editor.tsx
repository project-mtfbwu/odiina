"use client";

import { useState } from "react";
import { Button, Label, TextArea, TextField } from "react-aria-components";
import { useRouter } from "next/navigation";

import type { EntryMedia } from "@/lib/database/types";
import {
  localCivilDate,
  localTime,
  occurrenceFromLocalDateTime,
} from "@/lib/validation/timezone";

export function EntryEditor({
  entryId,
  currentRevisionId,
  initialBody,
  initialOccurredAt,
  initialOccurredTimezone,
  initialOccurredLocalDate,
  initialOccurredUtcOffsetMinutes,
  timezone,
  csrfToken,
  currentMedia,
}: {
  entryId: string;
  currentRevisionId: string;
  initialBody: string;
  initialOccurredAt: string;
  initialOccurredTimezone: string;
  initialOccurredLocalDate: string;
  initialOccurredUtcOffsetMinutes: number;
  timezone: string;
  csrfToken: string;
  currentMedia: EntryMedia[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [media, setMedia] = useState(currentMedia);
  const initialOccurrenceDate = localCivilDate(
    new Date(initialOccurredAt),
    timezone,
  );
  const initialOccurrenceTime = localTime(
    new Date(initialOccurredAt),
    timezone,
  );
  const [occurrenceDate, setOccurrenceDate] = useState(initialOccurrenceDate);
  const [occurrenceTime, setOccurrenceTime] = useState(initialOccurrenceTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = 100_000 - Array.from(body).length;
  const occurrenceChanged =
    occurrenceDate !== initialOccurrenceDate ||
    occurrenceTime !== initialOccurrenceTime;
  const changed =
    body !== initialBody ||
    occurrenceChanged ||
    media.map((item) => item.attachment_id).join(",") !==
      currentMedia.map((item) => item.attachment_id).join(",");

  async function save() {
    if (
      !changed ||
      (!body.trim() && media.length === 0) ||
      remaining < 0 ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const occurrence = occurrenceChanged
        ? occurrenceFromLocalDateTime(occurrenceDate, occurrenceTime, timezone)
        : {
            occurredAt: initialOccurredAt,
            occurredLocalDate: initialOccurredLocalDate,
            occurredTimezone: initialOccurredTimezone,
            occurredUtcOffsetMinutes: initialOccurredUtcOffsetMinutes,
          };
      const response = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          expectedCurrentRevisionId: currentRevisionId,
          bodyText: body,
          ...occurrence,
          changeReason: occurrenceChanged ? "occurrence_corrected" : "edited",
          attachmentIds: media.map((item) => item.attachment_id),
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Could not save this revision.");
      }
      router.replace(`/entries/${entryId}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this revision.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-4 sm:p-6" aria-labelledby="edit-entry-heading">
      <p className="eyebrow">New revision</p>
      <h2
        id="edit-entry-heading"
        className="m-0 text-xl font-bold tracking-[-0.03em]"
      >
        Edit Entry
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        Odiina preserves the current version. Saving creates a new immutable
        revision.
      </p>
      {error ? (
        <div className="form-error my-4" role="alert">
          <a href="#edit-body" className="font-bold underline">
            Entry text:
          </a>{" "}
          {error}
        </div>
      ) : null}
      <TextField className="field mt-5" value={body} onChange={setBody}>
        <Label className="field-label">Entry text</Label>
        <TextArea
          id="edit-body"
          className="textarea min-h-56"
          maxLength={100_000}
        />
      </TextField>
      <fieldset className="occurrence-editor">
        <legend>When this happened</legend>
        <label>
          <span>Occurrence date</span>
          <input
            type="date"
            value={occurrenceDate}
            onChange={(event) => setOccurrenceDate(event.target.value)}
          />
        </label>
        <label>
          <span>Occurrence time</span>
          <input
            type="time"
            value={occurrenceTime}
            onChange={(event) => setOccurrenceTime(event.target.value)}
          />
        </label>
        <p>
          Saving a different occurrence time creates immutable correction
          evidence and may move this Entry to another Calendar day.
        </p>
      </fieldset>
      {media.length > 0 ? (
        <section className="mt-5" aria-labelledby="edit-media-heading">
          <h3 id="edit-media-heading" className="text-sm font-bold">
            Attached images
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Removing or reordering creates a new revision. Earlier revisions
            keep their original image order.
          </p>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {media.map((item, index) => (
              <li
                key={item.attachment_id}
                className="rounded-xl border border-[var(--line)] p-3"
              >
                {/* Authenticated safe display derivative only. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${item.attachment_id}`}
                  alt={`Attached image ${index + 1} of ${media.length}`}
                  width={item.width}
                  height={item.height}
                  className="aspect-video w-full rounded-lg object-cover"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs"
                    isDisabled={busy || index === 0}
                    onPress={() =>
                      setMedia((current) => {
                        const next = [...current];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        return next;
                      })
                    }
                  >
                    Move earlier
                  </Button>
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs"
                    isDisabled={busy || index === media.length - 1}
                    onPress={() =>
                      setMedia((current) => {
                        const next = [...current];
                        [next[index], next[index + 1]] = [
                          next[index + 1],
                          next[index],
                        ];
                        return next;
                      })
                    }
                  >
                    Move later
                  </Button>
                  <Button
                    className="button button-quiet min-h-11 px-3 text-xs text-[var(--danger)]"
                    isDisabled={busy}
                    onPress={() =>
                      setMedia((current) =>
                        current.filter(
                          (candidate) =>
                            candidate.attachment_id !== item.attachment_id,
                        ),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">
          {remaining.toLocaleString("en")} characters left
        </span>
        <div className="flex gap-2">
          <Button
            className="button button-secondary"
            onPress={() => router.back()}
            isDisabled={busy}
          >
            Cancel
          </Button>
          <Button
            className="button button-primary"
            onPress={() => void save()}
            isDisabled={
              !changed ||
              (!body.trim() && media.length === 0) ||
              remaining < 0 ||
              busy
            }
          >
            {busy ? "Saving…" : "Save revision"}
          </Button>
        </div>
      </div>
    </section>
  );
}
