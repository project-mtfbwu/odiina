import {
  maximumTagsPerRevision,
  normalizeTagComparison,
  normalizeTagDisplay,
  tagLabelSchema,
} from "@/lib/validation/tag";

const hashtagPattern =
  /(^|[\s([{>"'“‘])#([\p{L}\p{N}\p{M}\p{Pc}](?:[\p{L}\p{N}\p{M}\p{Pc}-]*[\p{L}\p{N}\p{M}\p{Pc}])?(?:\/[\p{L}\p{N}\p{M}\p{Pc}](?:[\p{L}\p{N}\p{M}\p{Pc}-]*[\p{L}\p{N}\p{M}\p{Pc}])?)*)/gu;

function insideInlineCode(value: string, index: number): boolean {
  let fenced = false;
  for (let position = 0; position < index; position += 1) {
    if (value[position] === "`" && value[position - 1] !== "\\") {
      fenced = !fenced;
    }
  }
  return fenced;
}

export function tagQueryValue(value: string): string {
  return normalizeTagDisplay(value.replace(/^\s*#+/u, ""));
}

export function extractInlineHashtags(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(hashtagPattern)) {
    const hashIndex = (match.index ?? 0) + match[1].length;
    if (insideInlineCode(value, hashIndex)) continue;
    const parsed = tagLabelSchema.safeParse(match[2]);
    if (!parsed.success) continue;
    const comparison = normalizeTagComparison(parsed.data);
    if (seen.has(comparison)) continue;
    seen.add(comparison);
    result.push(parsed.data);
  }
  return result;
}

export function mergeInlineHashtags(
  value: string,
  selected: string[],
  ignored: ReadonlySet<string>,
): { tags: string[]; activeIgnored: Set<string>; added: string[] } {
  const inline = extractInlineHashtags(value);
  const inlineKeys = new Set(inline.map(normalizeTagComparison));
  const activeIgnored = new Set(
    [...ignored].filter((comparison) => inlineKeys.has(comparison)),
  );
  const tags = [...selected];
  const selectedKeys = new Set(tags.map(normalizeTagComparison));
  const added: string[] = [];
  for (const tag of inline) {
    const comparison = normalizeTagComparison(tag);
    if (
      tags.length >= maximumTagsPerRevision ||
      selectedKeys.has(comparison) ||
      activeIgnored.has(comparison)
    ) {
      continue;
    }
    tags.push(tag);
    selectedKeys.add(comparison);
    added.push(tag);
  }
  return { tags, activeIgnored, added };
}
