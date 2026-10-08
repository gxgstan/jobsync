// @vitest-environment node
import { generateText, streamText, readUIMessageStream, Output, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createSubscriptionModel } from "@/lib/ai/subscription-model";

describe("subscription provider with the actual AI SDK", () => {
  beforeEach(() => {
    vi.stubEnv("SUBSCRIPTION_RUNNER_URL", "http://runner:8787");
    vi.stubEnv("SUBSCRIPTION_RUNNER_TOKEN", "private-test-token");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("uses server credentials and leaves application writes pending approval", async () => {
    const execute = vi.fn();
    const fetchMock = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json({ text: "", toolCalls: [{ name: "save", arguments: '{"title":"Engineer"}' }] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateText({
      model: createSubscriptionModel("codex", "default"),
      prompt: "Save a role",
      tools: { save: tool({ inputSchema: z.object({ title: z.string() }), needsApproval: true, execute }) },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.content.some(part => part.type === "tool-approval-request")).toBe(true);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({ Authorization: "Bearer private-test-token" });
    expect(JSON.parse(options.body as string).tools[0].name).toBe("save");
  });

  it("keeps JSON schemas available for resume imports and automated matching", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: '{"score":91,"role":"Engineer"}', toolCalls: [] })));
    const result = await generateText({
      model: createSubscriptionModel("claude-code", "sonnet"), prompt: "Score this role",
      output: Output.object({ schema: z.object({ score: z.number(), role: z.string() }) }),
    });
    expect(result.output).toEqual({ score: 91, role: "Engineer" });
  });

  it("renders a streamed tool proposal as an approval card without executing it", async () => {
    const execute = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: "", toolCalls: [{ name: "save", arguments: '{"title":"Engineer"}' }] })));
    const result = streamText({
      model: createSubscriptionModel("codex", "default"), prompt: "Propose a role",
      tools: { save: tool({ inputSchema: z.object({ title: z.string() }), needsApproval: true, execute }) },
    });
    let finalMessage: UIMessage | undefined;
    for await (const message of readUIMessageStream({ stream: result.toUIMessageStream(), terminateOnError: true })) finalMessage = message;
    expect(execute).not.toHaveBeenCalled();
    expect(finalMessage?.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "tool-save", state: "approval-requested", input: { title: "Engineer" } })]));
  });

  it("emits a completed SDK stream for nested resume and cover letter generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ text: "A tailored letter", toolCalls: [], usage: { inputTokens: 20, outputTokens: 4 } })));
    const result = streamText({ model: createSubscriptionModel("codex", "default"), prompt: "Write a letter" });
    let text = ""; for await (const delta of result.textStream) text += delta;
    expect(text).toBe("A tailored letter");
    expect(await result.finishReason).toBe("stop");
    expect((await result.usage).outputTokens).toBe(4);
  });

  it("reports quota errors without switching to a paid API", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateText({ model: createSubscriptionModel("codex", "default"), prompt: "Hello" })).rejects.toThrow(/usage limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["codex", "claude-code"] as const)("sends the chosen %s model and effort to the runner", async provider => {
    const fetchMock = vi.fn(async (_url: unknown, _options?: RequestInit) => Response.json({ text: "OK", toolCalls: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await generateText({ model: createSubscriptionModel(provider, "model-a", "high"), prompt: "Hello" });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ provider, model: "model-a", effort: "high" });
  });

  it("passes cancellation to the private runner", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const model = createSubscriptionModel("codex", "default");
    const run = model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], abortSignal: controller.signal });
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });
});
