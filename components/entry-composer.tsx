"use client";

import { useMemo, useState } from "react";
import { Button, Label, TextArea, TextField } from "react-aria-components";
import { useRouter } from "next/navigation";

import { localCivilDate, utcOffsetMinutes } from "@/lib/validation/timezone";

const maximumLength = 100_000;

export function EntryComposer({
  csrfToken,
  timezone,
}: {
  csrfToken: string;
  timezone: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [clientRequestId, setClientRequestId] = useState(() =>
    crypto.randomUUID(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const remaining = maximumLength - Array.from(body).length;
  const valid = body.trim().length > 0 && remaining >= 0;
  const shortcut = useMemo(
    () =>
      typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
        ? "⌘ Enter"
        : "Ctrl Enter",
    [],
  );

  function updateBody(value: string) {
    setBody(value);
    setClientRequestId(crypto.randomUUID());
    setSaved(false);
    setError(null);
  }

  async function submit() {
    if (!valid || busy) {
      return;
    }
    if (!navigator.onLine) {
      setError(
        "You are offline. Your text is still here; reconnect to save it.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    const occurredAt = new Date();

    try {
      const response = await fetch("/api/entries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({
          clientRequestId,
          bodyText: body,
          occurredAt: occurredAt.toISOString(),
          occurredTimezone: timezone,
          occurredLocalDate: localCivilDate(occurredAt, timezone),
          occurredUtcOffsetMinutes: utcOffsetMinutes(occurredAt, timezone),
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Odiina could not save this Entry.");
      }

      setBody("");
      setClientRequestId(crypto.randomUUID());
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Odiina could not save this Entry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel mb-5 p-4 sm:p-5"
      aria-labelledby="capture-heading"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Capture</p>
          <h2
            id="capture-heading"
            className="m-0 text-xl font-bold tracking-[-0.03em]"
          >
            What happened?
          </h2>
        </div>
        <span className="rounded-full bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
          {timezone}
        </span>
      </div>

      {error ? (
        <div className="form-error mb-4" role="alert">
          <a className="font-bold underline" href="#entry-body">
            Entry text:
          </a>{" "}
          {error}
        </div>
      ) : null}

      <TextField
        className="field"
        value={body}
        onChange={updateBody}
        isInvalid={remaining < 0}
      >
        <Label className="sr-only">Entry text</Label>
        <TextArea
          id="entry-body"
          className="textarea border-0 bg-[var(--surface-raised)] shadow-inner shadow-black/3"
          placeholder="Write the raw version. You can refine it later."
          maxLength={maximumLength}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              valid
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </TextField>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-[var(--muted)]">
          <span
            className={remaining < 1000 ? "font-bold text-[var(--danger)]" : ""}
          >
            {remaining.toLocaleString()} characters left
          </span>
          <span className="hidden sm:inline"> · {shortcut} to save</span>
        </div>
        <Button
          className="button button-primary min-w-36"
          onPress={() => void submit()}
          isDisabled={!valid || busy}
        >
          {busy ? "Saving…" : "Add to today"}
        </Button>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {saved ? "Entry added to your Odiina Feed." : ""}
      </div>
    </section>
  );
}
