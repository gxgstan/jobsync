import "server-only";
import { AiProvider } from "@/models/ai.model";
import { defaultUserSettings, type AiSettings } from "@/models/userSettings.model";

export function defaultAiSettings(): AiSettings {
  const provider = process.env.DEFAULT_AI_PROVIDER;
  if (provider && Object.values(AiProvider).includes(provider as AiProvider)) {
    return { provider: provider as AiProvider, model: process.env.DEFAULT_AI_MODEL || undefined };
  }
  return defaultUserSettings.ai;
}
