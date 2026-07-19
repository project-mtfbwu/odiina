import { z } from "zod";

const feedCursorSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  entryId: z.uuid(),
});

export type FeedCursor = z.infer<typeof feedCursorSchema>;

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(
    JSON.stringify(feedCursorSchema.parse(cursor)),
    "utf8",
  ).toString("base64url");
}

export function decodeFeedCursor(value: string | null): FeedCursor | null {
  if (!value) {
    return null;
  }
  try {
    return feedCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}
