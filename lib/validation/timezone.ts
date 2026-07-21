export function isValidIanaTimezone(value: string): boolean {
  if (!value || value.length > 255) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function browserTimezoneSuggestion(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidIanaTimezone(value) ? value : null;
}

export function utcOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  const representedUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return Math.round((representedUtc - at.getTime()) / 60000);
}

export function localCivilDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function localTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.hour}:${values.minute}`;
}

function representedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

export function occurrenceFromLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
): {
  occurredAt: string;
  occurredLocalDate: string;
  occurredTimezone: string;
  occurredUtcOffsetMinutes: number;
} {
  if (!isValidIanaTimezone(timeZone)) {
    throw new Error("invalid_timezone");
  }
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dateMatch || !timeMatch) throw new Error("invalid_local_datetime");
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(naiveUtc);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day
  ) {
    throw new Error("invalid_local_datetime");
  }

  const probes = [-86_400_000, 0, 86_400_000].map((delta) =>
    utcOffsetMinutes(new Date(naiveUtc + delta), timeZone),
  );
  const candidates = [...new Set(probes)]
    .map((offset) => new Date(naiveUtc - offset * 60_000))
    .filter((candidate) => {
      const represented = representedParts(candidate, timeZone);
      return (
        represented.year === year &&
        represented.month === month &&
        represented.day === day &&
        represented.hour === hour &&
        represented.minute === minute
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());

  if (!candidates.length) throw new Error("nonexistent_local_time");
  const occurredAt = candidates[0];
  return {
    occurredAt: occurredAt.toISOString(),
    occurredLocalDate: date,
    occurredTimezone: timeZone,
    occurredUtcOffsetMinutes: utcOffsetMinutes(occurredAt, timeZone),
  };
}

export function isOccurrenceConsistent(input: {
  occurredAt: string;
  occurredLocalDate: string;
  occurredTimezone: string;
  occurredUtcOffsetMinutes: number;
}): boolean {
  try {
    const instant = new Date(input.occurredAt);
    if (!Number.isFinite(instant.getTime())) return false;
    if (
      localCivilDate(instant, input.occurredTimezone) !==
        input.occurredLocalDate ||
      utcOffsetMinutes(instant, input.occurredTimezone) !==
        input.occurredUtcOffsetMinutes
    ) {
      return false;
    }
    const canonical = occurrenceFromLocalDateTime(
      input.occurredLocalDate,
      localTime(instant, input.occurredTimezone),
      input.occurredTimezone,
    );
    return (
      Math.floor(new Date(canonical.occurredAt).getTime() / 60_000) ===
      Math.floor(instant.getTime() / 60_000)
    );
  } catch {
    return false;
  }
}
