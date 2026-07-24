import { z } from "zod";

export const chatCitationSchema = z.object({
  sourceId: z.uuid(),
  excerpt: z.string().trim().min(1).max(1_000),
});

export const chatOutputSchema = z.object({
  answer: z.string().trim().min(1).max(8_000),
  citations: z.array(chatCitationSchema).max(20),
  unsupportedClaimsRemoved: z.boolean(),
});

export type ChatOutput = z.infer<typeof chatOutputSchema>;

export function validateChatAnswer(
  output: unknown,
  allowedSourceIds: ReadonlySet<string>,
): ChatOutput {
  const parsed = chatOutputSchema.parse(output);
  if (/<script|javascript:|data:text\/html/iu.test(parsed.answer)) {
    throw new Error("unsafe_chat_output");
  }
  if (
    parsed.citations.some(({ sourceId }) => !allowedSourceIds.has(sourceId))
  ) {
    throw new Error("unsupported_chat_citation");
  }
  return parsed;
}
