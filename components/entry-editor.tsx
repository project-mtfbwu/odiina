"use client";

import { useState } from "react";
import { Button, Label, TextArea, TextField } from "react-aria-components";
import { useRouter } from "next/navigation";

import { localCivilDate, utcOffsetMinutes } from "@/lib/validation/timezone";

export function EntryEditor({
  entryId,
  currentRevisionId,
  initialBody,
  initialOccurredAt,
  timezone,
  csrfToken,
}: {
  entryId: string;
  currentRevisionId: string;
  initialBody: string;
  initialOccurredAt: string;
  timezone: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = 100_000 - Array.from(body).length;
  const changed = body !== initialBody;

  async function save() {
    if (!changed || !body.trim() || remaining < 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const occurredAt = new Date(initialOccurredAt);

    try {
      const response = await fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          expectedCurrentRevisionId: currentRevisionId,
          bodyText: body,
          occurredAt: occurredAt.toISOString(),
          occurredTimezone: timezone,
          occurredLocalDate: localCivilDate(occurredAt, timezone),
          occurredUtcOffsetMinutes: utcOffsetMinutes(occurredAt, timezone),
          changeReason: "edited",
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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[var(--muted)]">
          {remaining.toLocaleString()} characters left
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
            isDisabled={!changed || !body.trim() || remaining < 0 || busy}
          >
            {busy ? "Saving…" : "Save revision"}
          </Button>
        </div>
      </div>
    </section>
  );
}
