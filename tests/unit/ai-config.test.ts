import { afterEach, describe, expect, it } from "vitest";

import { getAiRuntimeStatus } from "@/lib/ai/config";

const previous = {
  feature: process.env.ODIINA_FEATURE_AI,
  provider: process.env.ODIINA_AI_PROVIDER,
  fake: process.env.ODIINA_ALLOW_FAKE_AI,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    ODIINA_FEATURE_AI: previous.feature,
    ODIINA_AI_PROVIDER: previous.provider,
    ODIINA_ALLOW_FAKE_AI: previous.fake,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("AI provider allowlist", () => {
  it("defaults provider execution off", () => {
    delete process.env.ODIINA_FEATURE_AI;
    delete process.env.ODIINA_AI_PROVIDER;
    delete process.env.ODIINA_ALLOW_FAKE_AI;
    expect(getAiRuntimeStatus().providerAvailable).toBe(false);
  });

  it("requires every explicit fake-provider gate", () => {
    process.env.ODIINA_FEATURE_AI = "true";
    process.env.ODIINA_AI_PROVIDER = "fake";
    process.env.ODIINA_ALLOW_FAKE_AI = "false";
    expect(getAiRuntimeStatus().providerAvailable).toBe(false);
    process.env.ODIINA_ALLOW_FAKE_AI = "true";
    expect(getAiRuntimeStatus().providerAvailable).toBe(true);
  });

  it("rejects arbitrary provider identifiers", () => {
    process.env.ODIINA_FEATURE_AI = "true";
    process.env.ODIINA_AI_PROVIDER = "user-controlled-model";
    expect(() => getAiRuntimeStatus()).toThrow();
  });
});
