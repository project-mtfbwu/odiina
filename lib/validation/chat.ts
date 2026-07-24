import { z } from "zod";

export const chatModeSchema = z.enum(["saved", "temporary"]);

export const chatRequestSchema = z.object({
  conversationId: z.uuid().nullable().default(null),
  mode: chatModeSchema,
  question: z.string().normalize("NFKC").trim().min(1).max(2_000),
  clientRequestId: z.uuid(),
});

export const chatUpdateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    title: z.string().normalize("NFKC").trim().min(1).max(120),
  }),
  z.object({ action: z.literal("clear_context") }),
  z.object({
    action: z.literal("convert"),
    title: z.string().normalize("NFKC").trim().min(1).max(120),
  }),
]);

export const deleteAllChatSchema = z.object({
  confirmation: z.literal("DELETE CHAT HISTORY"),
  includeTemporary: z.boolean().default(true),
});
