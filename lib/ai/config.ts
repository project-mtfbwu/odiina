import "server-only";

import { z } from "zod";

const aiEnvironmentSchema = z.object({
  ODIINA_FEATURE_AI: z.enum(["true", "false"]).default("false"),
  ODIINA_AI_PROVIDER: z.enum(["disabled", "fake"]).default("disabled"),
  ODIINA_ALLOW_FAKE_AI: z.enum(["true", "false"]).default("false"),
});

export type AiRuntimeStatus = {
  featureEnabled: boolean;
  providerId: "disabled" | "fake";
  providerAvailable: boolean;
  disclosure: string;
  liveProviderApproved: false;
};

export function getAiRuntimeStatus(): AiRuntimeStatus {
  const value = aiEnvironmentSchema.parse({
    ODIINA_FEATURE_AI: process.env.ODIINA_FEATURE_AI,
    ODIINA_AI_PROVIDER: process.env.ODIINA_AI_PROVIDER,
    ODIINA_ALLOW_FAKE_AI: process.env.ODIINA_ALLOW_FAKE_AI,
  });
  const featureEnabled = value.ODIINA_FEATURE_AI === "true";
  const fakeEnabled =
    value.ODIINA_AI_PROVIDER === "fake" &&
    value.ODIINA_ALLOW_FAKE_AI === "true";
  return {
    featureEnabled,
    providerId: value.ODIINA_AI_PROVIDER,
    providerAvailable: featureEnabled && fakeEnabled,
    disclosure: fakeEnabled
      ? "Deterministic local test provider. No journal content leaves this machine."
      : "No AI provider is approved or configured. Provider requests remain blocked.",
    liveProviderApproved: false,
  };
}
