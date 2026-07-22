import { z } from "zod";

export const maximumTagsPerRevision = 10;
export const maximumTagCharacters = 40;

const unicodeControlPattern = /\p{Cc}/u;

export function normalizeTagDisplay(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeTagComparison(value: string): string {
  return normalizeTagDisplay(value).toLocaleLowerCase("und");
}

export const tagLabelSchema = z.string().transform((value, context) => {
  const displayName = normalizeTagDisplay(value);
  const length = Array.from(displayName).length;
  if (
    length < 1 ||
    length > maximumTagCharacters ||
    unicodeControlPattern.test(displayName)
  ) {
    context.addIssue({
      code: "custom",
      message: "Use 1–40 characters without control characters.",
    });
    return z.NEVER;
  }
  return displayName;
});

export const tagListSchema = z
  .array(tagLabelSchema)
  .max(maximumTagsPerRevision, "An Entry can have up to 10 tags.")
  .superRefine((tags, context) => {
    const normalized = new Set<string>();
    for (const tag of tags) {
      const comparison = normalizeTagComparison(tag);
      if (normalized.has(comparison)) {
        context.addIssue({
          code: "custom",
          message: `“${tag}” is already selected.`,
        });
      }
      normalized.add(comparison);
    }
  });

export type TagLabel = z.infer<typeof tagLabelSchema>;
