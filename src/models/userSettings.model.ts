import { AiProvider, type AiModel } from "./ai.model";

export type AiSettings = AiModel;

export interface DisplaySettings {
  theme: "light" | "dark" | "system";
}

export interface UserSettingsData {
  ai: AiSettings;
  display: DisplaySettings;
}

export interface UserSettings {
  userId: string;
  settings: UserSettingsData;
}

export const defaultUserSettings: UserSettingsData = {
  ai: {
    provider: AiProvider.OLLAMA,
    model: undefined,
  },
  display: {
    theme: "system",
  },
};
