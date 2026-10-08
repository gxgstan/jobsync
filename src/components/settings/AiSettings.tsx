"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AiModel,
  AiProvider,
  defaultModel,
  OpenaiModel,
  DeepseekModel,
  GeminiModel,
  type SubscriptionModelInfo,
} from "@/models/ai.model";
import {
  PROVIDER_REGISTRY,
  AI_PROVIDERS,
} from "@/lib/ai/provider-registry";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { toastSuccess, toastError } from "@/lib/toast";
import { XCircle, Loader2, RefreshCw } from "lucide-react";
import { checkOllamaConnection } from "@/utils/ai.utils";
import { getUserSettings, updateAiSettings } from "@/actions/userSettings.actions";
import { useAgentChat } from "@/components/agent/AgentChatProvider";

function AiSettings() {
  const { isOpen: isAgentChatOpen, refreshPreflight } = useAgentChat();
  const [selectedModel, setSelectedModel] = useState<AiModel>(defaultModel);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelDetails, setModelDetails] = useState<SubscriptionModelInfo[]>([]);
  const modelRequest = useRef<AbortController | undefined>(undefined);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [fetchError, setFetchError] = useState<string>("");
  const [connectionError, setConnectionError] = useState<string>("");


  const setSelectedProvider = (provider: AiProvider) => {
    setSelectedModel({ provider, model: undefined });
    setModelDetails([]);
    setFetchError("");
    setConnectionError("");
  };

  const setSelectedProviderModel = (model: string) => {
    setSelectedModel((prev) => ({ ...prev, model, effort: undefined }));
  };

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const settingsResult = await getUserSettings();

        if (settingsResult.success && settingsResult.data?.settings?.ai) {
          const aiSettings = settingsResult.data.settings.ai;
          setSelectedModel({
            provider: aiSettings.provider || defaultModel.provider,
            model: aiSettings.model,
            effort: aiSettings.effort,
          });
        }
      } catch (error) {
        console.error("Error fetching user settings:", error);
      } finally {
        setIsLoadingSettings(false);
        setIsInitialized(true);
      }
    };
    fetchSettings();
  }, []);

  const getFallbackModels = (provider: AiProvider): string[] => {
    switch (provider) {
      case AiProvider.OPENAI:
        return Object.values(OpenaiModel);
      case AiProvider.DEEPSEEK:
        return Object.values(DeepseekModel);
      case AiProvider.GEMINI:
        return Object.values(GeminiModel);
      default:
        return [];
    }
  };

  const fetchModelsForProvider = useCallback(
    (provider: AiProvider, refresh = false) => {
      modelRequest.current?.abort();
      const entry = PROVIDER_REGISTRY[provider];
      if (!entry) return () => {};

      if (!entry.modelsEndpoint) {
        const fallbackModels = getFallbackModels(provider);
        setFetchedModels(fallbackModels);
        setModelDetails([]);
        setSelectedModel((prev) =>
          prev.model && !fallbackModels.includes(prev.model)
            ? { ...prev, model: undefined }
            : prev,
        );
        return () => {};
      }

      const fallback = getFallbackModels(provider);
      const controller = new AbortController();
      modelRequest.current = controller;
      const errorMessage = entry.category === "local"
        ? `Failed to fetch ${entry.displayName} models. Make sure ${entry.displayName} is running.`
        : entry.category === "subscription"
          ? `Failed to load ${entry.displayName} models. Retry or reconnect the subscription on Tinyboy.`
          : `Failed to fetch ${entry.displayName} models. Please check your API key in API Keys settings.`;
      setModelDetails([]);
      setIsLoadingModels(true);
      setFetchError("");
      setConnectionError("");

      (async () => {
        try {
          if (entry.category === "local") {
            const connResult = await checkOllamaConnection(provider);
            if (!connResult.isConnected) {
              if (!controller.signal.aborted) {
                setFetchedModels(fallback);
                setConnectionError(connResult.error || "Ollama is not reachable.");
              }
              return;
            }
          }
          const endpoint = `/api/ai/${entry.modelsEndpoint}${refresh && entry.category === "subscription" ? "&refresh=1" : ""}`;
          const response = await fetch(endpoint, { signal: controller.signal });
          if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            const errorMsg = errorData?.error
              || errorMessage;
            if (!controller.signal.aborted) {
              setFetchError(errorMsg);
              setFetchedModels(fallback);
            }
            return;
          }
          const data = await response.json();
          const models = entry.parseModelsResponse?.(data) ?? [];
          const finalModels = models.length > 0 ? models : fallback;
          const details: SubscriptionModelInfo[] = entry.category === "subscription" ? data.modelDetails ?? [] : [];
          if (!controller.signal.aborted) {
            setFetchedModels(finalModels);
            setModelDetails(details);
            setSelectedModel((prev) => {
              if (prev.model && !finalModels.includes(prev.model)) return { ...prev, model: undefined, effort: undefined };
              if (prev.effort && !details.find(m => m.id === prev.model)?.effortLevels.includes(prev.effort)) return { ...prev, effort: undefined };
              return prev;
            });
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            console.error(`Error fetching ${entry.displayName} models:`, error);
            setFetchedModels(fallback);
            setFetchError(errorMessage);
          }
        } finally {
          if (!controller.signal.aborted) setIsLoadingModels(false);
        }
      })();

      return () => controller.abort();
    },
    [],
  );

  useEffect(() => {
    if (!isInitialized) return;
    fetchModelsForProvider(selectedModel.provider);
    return () => modelRequest.current?.abort();
  }, [selectedModel.provider, isInitialized, fetchModelsForProvider]);

  const retryConnection = () => {
    fetchModelsForProvider(selectedModel.provider, true);
  };

  const saveModelSettings = async () => {
    if (!selectedModel.model) {
      toastError("Please select a model to save.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await updateAiSettings({
        provider: selectedModel.provider,
        model: selectedModel.model,
        effort: selectedModel.effort,
      });
      if (result.success) {
        toastSuccess("AI Settings saved successfully.", "Saved!");
        if (isAgentChatOpen) void refreshPreflight();
      } else {
        toastError(result.message || "Failed to save AI settings.");
      }
    } catch (error) {
      console.error("Error saving AI settings:", error);
      toastError("Failed to save AI settings.");
    } finally {
      setIsSaving(false);
    }
  };

  // Radix reads an undefined value as uncontrolled and falls back to its own
  // internal state, which still holds the previous provider's pick; a value
  // matching no item renders neither item text nor placeholder.
  const modelValue =
    selectedModel.model && fetchedModels.includes(selectedModel.model)
      ? selectedModel.model
      : "";
  const selectedInfo = modelDetails.find(model => model.id === modelValue);
  const effortLevels = selectedInfo?.effortLevels ?? [];
  const effortLabel = (effort: string) => effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1);

  if (isLoadingSettings) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium">AI Provider</h3>
          <p className="text-sm text-muted-foreground">
            Configure your AI service provider and model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">AI Provider</h3>
        <p className="text-sm text-muted-foreground">
          Configure your AI service provider and model.
        </p>
      </div>
      <div>
        <Label className="my-4" htmlFor="ai-provider">
          AI Service Provider
        </Label>
        <Select
          value={selectedModel.provider}
          onValueChange={setSelectedProvider}
        >
          <SelectTrigger
            id="ai-provider"
            aria-label="Select AI provider"
            className="w-[280px]"
          >
            <SelectValue placeholder="Select AI Service Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {AI_PROVIDERS.map((id) => {
                const entry = PROVIDER_REGISTRY[id];
                return (
                  <SelectItem key={id} value={id}>
                    {entry.displayName}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="my-4" htmlFor="ai-model">
          Model
        </Label>
        {PROVIDER_REGISTRY[selectedModel.provider]?.category === "subscription" && (
          <p className="mb-3 text-sm text-muted-foreground">
            Uses your subscription signed in on Tinyboy. No API key is needed. Usage shares your subscription limits.
          </p>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <Select
            value={isLoadingModels ? "" : modelValue}
            onValueChange={setSelectedProviderModel}
            disabled={isLoadingModels}
          >
            <SelectTrigger
              id="ai-model"
              aria-label="Select Model"
              className="w-full max-w-[320px]"
            >
              {/* a flex row here must nest inside SelectValue's span, which the
                  trigger's [&>span]:line-clamp-1 outranks */}
              <SelectValue
                placeholder={
                  isLoadingModels ? (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading models...
                    </span>
                  ) : (
                    "Select Model"
                  )
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {fetchedModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {modelDetails.find(info => info.id === model)?.displayName ?? (selectedModel.provider === AiProvider.CODEX && model === "default" ? "Tinyboy default" : model)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fetchError && (
            <div className="flex items-start gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={retryConnection} disabled={isLoadingModels}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
              </Button>
              <div className="flex items-start gap-1 text-red-600 text-sm">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{fetchError}</span>
              </div>
            </div>
          )}
          {connectionError && (
            <div className="flex items-start gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 text-muted-foreground"
                onClick={retryConnection}
                disabled={isLoadingModels}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingModels ? "animate-spin" : ""}`} />
                Retry
              </Button>
              <div className="flex items-start gap-1 text-red-600 text-sm">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{connectionError}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {PROVIDER_REGISTRY[selectedModel.provider]?.category === "subscription" && (
        <div>
          <Label className="my-4" htmlFor="ai-effort">Effort level</Label>
          <Select
            value={selectedModel.effort && effortLevels.includes(selectedModel.effort) ? selectedModel.effort : "default"}
            onValueChange={(effort) => setSelectedModel(prev => ({ ...prev, effort: effort === "default" ? undefined : effort }))}
            disabled={isLoadingModels || !modelValue || !effortLevels.length}
          >
            <SelectTrigger id="ai-effort" aria-label="Select effort level" className="w-full max-w-[320px]">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{selectedInfo?.defaultEffort ? `Default (${effortLabel(selectedInfo.defaultEffort)})` : "Default"}</SelectItem>
              {effortLevels.map(effort => <SelectItem key={effort} value={effort}>{effortLabel(effort)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="mt-2 text-sm text-muted-foreground">
            {modelValue && !isLoadingModels && !effortLevels.length
              ? "This model does not support an adjustable effort level."
              : "Higher effort can take longer and use more of your subscription allowance."}
          </p>
        </div>
      )}
      <Button
        className="mt-4"
        onClick={saveModelSettings}
        disabled={!modelValue || isLoadingModels || isSaving}
      >
        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

export default AiSettings;
