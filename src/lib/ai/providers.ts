import { resolveApiKey } from "@/lib/api-key-resolver";
import { PROVIDER_REGISTRY } from "@/lib/ai/provider-registry";
import { PROVIDER_FACTORIES } from "@/lib/ai/provider-registry.server";
import { createSubscriptionModel } from "@/lib/ai/subscription-model";

export type ProviderType = "openai" | "ollama" | "deepseek" | "openrouter" | "gemini" | "claude-code" | "codex";

export async function getModel(
  provider: ProviderType,
  modelName: string,
  userId?: string,
) {
  if (provider === "claude-code" || provider === "codex") {
    return createSubscriptionModel(provider, modelName);
  }
  const entry = PROVIDER_REGISTRY[provider];
  if (!entry) throw new Error(`Unknown AI provider: ${provider}`);

  const factory = PROVIDER_FACTORIES[provider];
  if (!factory) throw new Error(`No factory for provider: ${provider}`);

  const credential = await resolveApiKey(userId, provider);
  if (!credential)
    throw new Error(`${entry.displayName} credential not configured`);

  return factory(credential, modelName);
}
