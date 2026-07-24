import type { ChatRetrievalPlan } from "@/lib/chat/types";

type PlannerContext = {
  today: string;
  weekStartsOn: number;
  transcriptSearchEnabled: boolean;
  previous?: ChatRetrievalPlan | null;
};

const mediaTerms = [
  ["image", /\b(photo|photos|picture|pictures|image|images)\b/iu],
  ["audio", /\b(voice note|voice notes|audio|recording|recordings)\b/iu],
  ["video", /\b(video|videos|clip|clips)\b/iu],
  ["place", /\b(place|places|visit|visited|location|locations)\b/iu],
] as const;

function civilDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatCivil(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function monthRange(today: Date, offset: number): [string, string] {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1),
  );
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset + 1, 0),
  );
  return [formatCivil(start), formatCivil(end)];
}

function yearRange(today: Date, offset: number): [string, string] {
  const year = today.getUTCFullYear() + offset;
  return [`${year}-01-01`, `${year}-12-31`];
}

function weekRange(
  today: Date,
  weekStartsOn: number,
  offsetWeeks: number,
): [string, string] {
  const offset = (today.getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDays(today, -offset + offsetWeeks * 7);
  return [formatCivil(start), formatCivil(addDays(start, 6))];
}

function explicitDates(question: string): [string | null, string | null] {
  const dates = [...question.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/gu)].map(
    (match) => match[1]!,
  );
  if (dates.length >= 2) return [dates[0]!, dates[1]!];
  if (/\bafter\b/iu.test(question) && dates[0]) return [dates[0], null];
  if (/\bbefore\b/iu.test(question) && dates[0]) return [null, dates[0]];
  return dates[0] ? [dates[0], dates[0]] : [null, null];
}

function resolveRange(
  question: string,
  todayText: string,
  weekStartsOn: number,
): [string | null, string | null, string] {
  const today = civilDate(todayText);
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const mentionedMonths = monthNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => new RegExp(`\\b${name}\\b`, "iu").test(question));
  if (/\byesterday\b/iu.test(question)) {
    const date = formatCivil(addDays(today, -1));
    return [date, date, `Yesterday · ${date}`];
  }
  if (/\btoday\b/iu.test(question))
    return [todayText, todayText, `Today · ${todayText}`];
  if (/\blast week\b/iu.test(question)) {
    const [from, to] = weekRange(today, weekStartsOn, -1);
    return [from, to, `Last week · ${from} to ${to}`];
  }
  if (/\bthis week\b/iu.test(question)) {
    const [from, to] = weekRange(today, weekStartsOn, 0);
    return [from, to, `This week · ${from} to ${to}`];
  }
  if (/\blast month\b/iu.test(question)) {
    const [from, to] = monthRange(today, -1);
    return [from, to, `Last month · ${from} to ${to}`];
  }
  if (/\bthis month\b/iu.test(question)) {
    const [from, to] = monthRange(today, 0);
    return [from, to, `This month · ${from} to ${to}`];
  }
  if (/\blast year\b/iu.test(question)) {
    const [from, to] = yearRange(today, -1);
    return [from, to, `Last year · ${from} to ${to}`];
  }
  if (/\bthis year\b/iu.test(question)) {
    const [from, to] = yearRange(today, 0);
    return [from, to, `This year · ${from} to ${to}`];
  }
  if (mentionedMonths.length) {
    const first = mentionedMonths[0]!;
    const last = mentionedMonths.at(-1)!;
    const year = today.getUTCFullYear();
    const start = new Date(Date.UTC(year, first.index, 1));
    const end = new Date(Date.UTC(year, last.index + 1, 0));
    const from = formatCivil(start);
    const to = formatCivil(end);
    return [
      from,
      to,
      `${first.name[0]!.toUpperCase()}${first.name.slice(1)}${first !== last ? ` to ${last.name[0]!.toUpperCase()}${last.name.slice(1)}` : ""} ${year} · ${from} to ${to}`,
    ];
  }
  const [from, to] = explicitDates(question);
  return [
    from,
    to,
    from || to
      ? `Resolved dates · ${from ?? "…"} to ${to ?? "…"}`
      : "All dates",
  ];
}

function normalizeTag(value: string): string {
  return value.normalize("NFKC").replace(/^#/, "").toLocaleLowerCase("und");
}

function extractPlace(question: string): string {
  const match = question.match(
    /\b(?:visit(?:ed)?|at)\s+([\p{L}\p{N}][\p{L}\p{N}\p{M} .'-]{1,80}?)(?:\?|$|\b(?:last|this|yesterday|today)\b)/iu,
  );
  return match?.[1]?.trim() ?? "";
}

function lexicalQuery(question: string): string {
  return (
    question
      .normalize("NFKC")
      .replace(/#[\p{L}\p{N}\p{M}_/-]+/gu, " ")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/gu, " ")
      .replace(
        /\b(what|when|where|which|show|find|summarize|compare|did|do|write|wrote|log|logged|entry|entries|memory|memories|i|me|my|the|a|an|about|connected|to|from|in|on|only|last|this|today|yesterday|week|month|year|voice|notes?|audio|photos?|pictures?|images?|videos?|places?|visited?)\b/giu,
        " ",
      )
      // websearch_to_tsquery treats punctuation such as a hyphen as syntax.
      // Tags are already extracted above, so ordinary query punctuation must be
      // token boundaries rather than provider- or user-controlled operators.
      .replace(/[^\p{L}\p{N}\p{M}_]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 200)
  );
}

export function planChatQuestion(
  question: string,
  context: PlannerContext,
): ChatRetrievalPlan {
  const trimmed = question.normalize("NFKC").trim();
  const previous = context.previous ?? null;
  const [resolvedFrom, resolvedTo, resolvedLabel] = resolveRange(
    trimmed,
    context.today,
    context.weekStartsOn,
  );
  const hasDatePhrase =
    /\b(today|yesterday|this week|last week|this month|last month|this year|last year|before|after|january|february|march|april|may|june|july|august|september|october|november|december)\b|\d{4}-\d{2}-\d{2}/iu.test(
      trimmed,
    );
  const tags = [
    ...new Set(
      [...trimmed.matchAll(/(?:^|\s)#([\p{L}\p{N}\p{M}_/-]+)/gu)].map((match) =>
        normalizeTag(match[1]!),
      ),
    ),
  ].slice(0, 10);
  const media = mediaTerms
    .filter(([, pattern]) => pattern.test(trimmed))
    .map(([kind]) => kind);
  const query = lexicalQuery(trimmed);
  const followUp =
    previous &&
    (/^only\b/iu.test(trimmed) || trimmed.split(/\s+/u).length <= 5);

  return {
    query: query || (followUp ? previous.query : ""),
    tags: tags.length ? tags : followUp ? previous.tags : [],
    media: media.length ? media : followUp ? previous.media : [],
    place: extractPlace(trimmed) || (followUp ? previous.place : ""),
    from: hasDatePhrase
      ? resolvedFrom
      : followUp
        ? previous.from
        : resolvedFrom,
    to: hasDatePhrase ? resolvedTo : followUp ? previous.to : resolvedTo,
    sort: /\b(first|earliest|oldest)\b/iu.test(trimmed) ? "oldest" : "newest",
    includeTranscripts: context.transcriptSearchEnabled,
    resolvedLabel: hasDatePhrase
      ? resolvedLabel
      : followUp
        ? previous.resolvedLabel
        : resolvedLabel,
  };
}
