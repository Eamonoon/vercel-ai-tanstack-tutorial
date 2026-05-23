import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "@/env";

const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export function getModel(provider?: string) {
  const activeProvider = provider ?? env.DEFAULT_PROVIDER;

  switch (activeProvider) {
    case "openai":
      return openai(env.OPENAI_MODEL);
    case "anthropic":
      return anthropic(env.ANTHROPIC_MODEL);
    default:
      throw new Error(`Unknown provider: ${activeProvider}`);
  }
}

export { openai, anthropic };
