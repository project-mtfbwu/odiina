"use client";

import { useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { useRouter } from "next/navigation";

import { browserTimezoneSuggestion } from "@/lib/validation/timezone";

export function PreferencesForm({
  initialTimezone,
  initialWeekStartsOn,
  csrfToken,
  onboarding = false,
}: {
  initialTimezone: string | null;
  initialWeekStartsOn: number;
  csrfToken: string;
  onboarding?: boolean;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(initialTimezone ?? "");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [weekStartsOn, setWeekStartsOn] = useState(initialWeekStartsOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSuggestion(browserTimezoneSuggestion());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-odiina-csrf": csrfToken,
        },
        body: JSON.stringify({ timezone, weekStartsOn }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(result.message ?? "Could not save your settings.");
      }
      setSaved(true);
      if (onboarding) {
        router.replace("/feed");
      } else {
        router.refresh();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save your settings.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      {suggestion && suggestion !== timezone ? (
        <div className="rounded-xl bg-[var(--accent-soft)] p-4 text-sm leading-6 text-[#3e327e]">
          Your browser suggests <strong>{suggestion}</strong>. Confirm it rather
          than assuming it is correct.{" "}
          <Button
            className="ml-1 font-bold underline"
            onPress={() => setTimezone(suggestion)}
          >
            Use suggestion
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          <a href="#timezone" className="font-bold underline">
            Timezone:
          </a>{" "}
          {error}
        </div>
      ) : null}

      <TextField
        className="field"
        value={timezone}
        onChange={setTimezone}
        isRequired
      >
        <Label className="field-label">IANA timezone</Label>
        <Input
          id="timezone"
          className="input"
          placeholder="Europe/London"
          autoComplete="off"
          maxLength={255}
        />
        <p className="field-description">
          This preserves the civil day where an Entry occurred. It is never
          inferred silently.
        </p>
      </TextField>

      <div className="field">
        <label className="field-label" htmlFor="week-start">
          Week starts on
        </label>
        <select
          className="select"
          id="week-start"
          value={weekStartsOn}
          onChange={(event) => setWeekStartsOn(Number(event.target.value))}
        >
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
          <option value={6}>Saturday</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="button button-primary"
          onPress={() => void save()}
          isDisabled={busy || !timezone}
        >
          {busy
            ? "Saving…"
            : onboarding
              ? "Confirm and continue"
              : "Save settings"}
        </Button>
        <span className="text-sm text-[var(--success)]" aria-live="polite">
          {saved ? "Settings saved." : ""}
        </span>
      </div>
    </div>
  );
}
