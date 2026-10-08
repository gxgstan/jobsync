import "server-only";

import { APICallError } from "ai";
import type { SubscriptionModelInfo } from "@/models/ai.model";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

export type SubscriptionProvider = "claude-code" | "codex";

export function subscriptionConfig() {
  const url = process.env.SUBSCRIPTION_RUNNER_URL;
  const token = process.env.SUBSCRIPTION_RUNNER_TOKEN;
  if (!url || !token) throw new Error("Subscription runner is not configured");
  return { url: url.replace(/\/+$/, ""), token };
}

export async function subscriptionModels(provider: SubscriptionProvider, refresh = false) {
  const { url, token } = subscriptionConfig();
  const response = await fetch(`${url}/models?provider=${provider}${refresh ? "&refresh=1" : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || "Subscription model discovery is unavailable on the server");
  }
  return response.json() as Promise<{ models: string[]; modelDetails: SubscriptionModelInfo[] }>;
}

/** Keep all application tool execution and approval in the AI SDK. The runner
 * produces proposals; it cannot execute JobSync tools or access its database. */
export function createSubscriptionModel(
  provider: SubscriptionProvider,
  modelId: string,
  effort?: string,
): LanguageModelV3 {
  const { url, token } = subscriptionConfig();

  const generate = async (
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> => {
    const response = await fetch(`${url}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        provider,
        model: modelId,
        effort,
        prompt: options.prompt,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
      }),
      signal: options.abortSignal,
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "The selected subscription model or effort is unavailable. Refresh AI Settings.",
        401: "Reconnect the subscription account on Tinyboy.",
        429: "The subscription is busy or has reached its usage limit. Try again later.",
        504: "The subscription request took too long. Try again.",
      };
      throw new APICallError({
        message: messages[response.status] ?? "The subscription runner could not complete the request.",
        url: `${url}/generate`,
        requestBodyValues: {},
        statusCode: response.status,
        isRetryable: false,
      });
    }
    const data = await response.json();
    const content: LanguageModelV3GenerateResult["content"] = [];
    if (typeof data.text !== "string" || !Array.isArray(data.toolCalls)) {
      throw new Error("Invalid subscription runner response");
    }
    if (data.text) content.push({ type: "text", text: data.text });
    for (const call of data.toolCalls) {
      if (typeof call.name !== "string" || typeof call.arguments !== "string") {
        throw new Error("Invalid subscription tool proposal");
      }
      content.push({ type: "tool-call", toolCallId: crypto.randomUUID(), toolName: call.name, input: call.arguments });
    }
    return {
      content,
      finishReason: { unified: data.toolCalls.length ? "tool-calls" : "stop", raw: undefined },
      usage: {
        inputTokens: { total: data.usage?.inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: data.usage?.outputTokens, text: undefined, reasoning: undefined },
      },
      warnings: [],
    };
  };

  return {
    specificationVersion: "v3",
    provider,
    modelId,
    supportedUrls: {},
    doGenerate: generate,
    async doStream(options) {
      const abort = new AbortController();
      const signals = [abort.signal];
      if (options.abortSignal) signals.push(options.abortSignal);
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            try {
              const result = await generate({ ...options, abortSignal: AbortSignal.any(signals) });
              for (const part of result.content) {
                if (part.type === "text") {
                  controller.enqueue({ type: "text-start", id: "text" });
                  controller.enqueue({ type: "text-delta", id: "text", delta: part.text });
                  controller.enqueue({ type: "text-end", id: "text" });
                } else if (part.type === "tool-call") {
                  controller.enqueue(part);
                }
              }
              controller.enqueue({ type: "finish", finishReason: result.finishReason, usage: result.usage });
              controller.close();
            } catch (error) {
              if (!abort.signal.aborted) controller.error(error);
            }
          },
          cancel() { abort.abort(); },
        }),
      };
    },
  };
}
