import { createOpenAI } from "@ai-sdk/openai";

/**
 * Retrieves the configured chat model from OpenRouter or another provider.
 * Easily switch models or provider URLs by editing environment variables.
 */
export function getChatModel() {
  const provider = process.env.LLM_PROVIDER || "openrouter";
  let apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || "";
  const modelName = process.env.LLM_MODEL || "cohere/north-mini-code:free";

  // Clean quotes from environment variable
  if ((apiKey.startsWith("'") && apiKey.endsWith("'")) || (apiKey.startsWith('"') && apiKey.endsWith('"'))) {
    apiKey = apiKey.substring(1, apiKey.length - 1);
  }

  console.log(`[LLM Config] Provider: ${provider}, Model: ${modelName}, Key length: ${apiKey.length}, Key prefix: ${apiKey.slice(0, 10)}`);

  if (provider === "openrouter") {
    const openrouter = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
    });
    return openrouter(modelName);
  }

  // Fallback to standard OpenAI provider
  const openai = createOpenAI({
    apiKey,
  });
  return openai(modelName);
}
