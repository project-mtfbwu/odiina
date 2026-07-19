export function entryPreview(text: string, maximum = 420): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const characters = Array.from(normalized);
  if (characters.length <= maximum) {
    return normalized;
  }
  return `${characters.slice(0, maximum).join("").trimEnd()}…`;
}
