import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AiSettings from "@/components/settings/AiSettings";
import type { SubscriptionModelInfo } from "@/models/ai.model";

const getUserSettings = vi.fn();
const updateAiSettings = vi.fn();

vi.mock("@/actions/userSettings.actions", () => ({
  getUserSettings: () => getUserSettings(),
  updateAiSettings: (...args: unknown[]) => updateAiSettings(...args),
}));

vi.mock("@/components/agent/AgentChatProvider", () => ({
  useAgentChat: () => ({ isOpen: false, refreshPreflight: vi.fn() }),
}));

vi.mock("@/utils/ai.utils", () => ({
  checkOllamaConnection: vi.fn().mockResolvedValue({ isConnected: true }),
}));

vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

// jsdom implements none of these, and Radix Select calls all four
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const modelTrigger = () => screen.getByLabelText("Select Model");
const providerTrigger = () => screen.getByLabelText("Select AI provider");
const effortTrigger = () => screen.getByLabelText("Select effort level");

const codexModels = [
  { id: "default", displayName: "Tinyboy default", effortLevels: ["low", "high"], defaultEffort: "high" },
  { id: "model-a", displayName: "Model A", effortLevels: ["low", "high", "ultra"], defaultEffort: "low" },
  { id: "model-b", displayName: "Model B", effortLevels: ["low"], defaultEffort: "low" },
];
const claudeModels = [
  { id: "sonnet", displayName: "Sonnet", effortLevels: ["low", "medium", "high", "max"] },
  { id: "legacy", displayName: "Legacy", effortLevels: [] },
];
function mockSubscriptionModels(details: SubscriptionModelInfo[] = codexModels) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ models: details.map(m => m.id), modelDetails: details }) })) as unknown as typeof fetch;
}

async function pick(trigger: HTMLElement, optionName: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

function mockModels(ids: string[]) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ data: ids.map((id) => ({ id })) }),
    }),
  ) as unknown as typeof fetch;
}

describe("AiSettings model select", () => {
  beforeEach(() => {
    updateAiSettings.mockResolvedValue({ success: true });
    getUserSettings.mockResolvedValue({
      success: true,
      data: {
        userId: "u1",
        settings: { ai: { provider: "ollama", model: "llama3.1" }, display: {} },
      },
    });
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.1" }] }),
      }),
    ) as unknown as typeof fetch;
  });

  it("prompts for a model after every provider switch, not just the first", async () => {
    render(<AiSettings />);
    await waitFor(() => expect(modelTrigger().textContent).toBe("llama3.1"));

    mockModels(["deepseek-chat"]);
    await pick(providerTrigger(), "DeepSeek");
    await waitFor(() => expect(modelTrigger().textContent).toBe("Select Model"));

    // Picking a model is what used to leave Radix holding a stale value
    await pick(modelTrigger(), "deepseek-chat");
    await waitFor(() => expect(modelTrigger().textContent).toBe("deepseek-chat"));

    mockModels(["gpt-4o"]);
    await pick(providerTrigger(), "OpenAI");
    await waitFor(() => expect(modelTrigger().textContent).toBe("Select Model"));
  });

  it("shows a spinner while the model list loads", async () => {
    render(<AiSettings />);
    await waitFor(() => expect(modelTrigger().textContent).toBe("llama3.1"));

    let release: (value: unknown) => void = () => {};
    global.fetch = vi.fn(
      () => new Promise((resolve) => { release = resolve; }),
    ) as unknown as typeof fetch;

    await pick(providerTrigger(), "DeepSeek");

    await waitFor(() => expect(modelTrigger()).toBeDisabled());
    expect(modelTrigger().textContent).toContain("Loading models...");
    expect(modelTrigger().querySelector(".animate-spin")).toBeTruthy();

    release({ ok: true, json: async () => ({ data: [{ id: "deepseek-chat" }] }) });
    await waitFor(() => expect(modelTrigger().textContent).toBe("Select Model"));
  });

  it("lets Codex select an explicit model and effort, saves both, and restores them after reload", async () => {
    getUserSettings.mockResolvedValue({ success: true, data: { settings: { ai: { provider: "codex", model: "default" } } } });
    mockSubscriptionModels();
    const view = render(<AiSettings />);
    await waitFor(() => expect(modelTrigger().textContent).toBe("Tinyboy default"));
    await pick(modelTrigger(), "Model A");
    await pick(effortTrigger(), "Ultra");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ provider: "codex", model: "model-a", effort: "ultra" }));
    view.unmount();
    getUserSettings.mockResolvedValue({ success: true, data: { settings: { ai: updateAiSettings.mock.calls.at(-1)?.[0] } } });
    render(<AiSettings />);
    await waitFor(() => expect(modelTrigger().textContent).toBe("Model A"));
    expect(effortTrigger().textContent).toBe("Ultra");
  });

  it("clears effort when switching providers and saves Claude's selected effort", async () => {
    getUserSettings.mockResolvedValue({ success: true, data: { settings: { ai: { provider: "codex", model: "model-a", effort: "ultra" } } } });
    mockSubscriptionModels();
    render(<AiSettings />);
    await waitFor(() => expect(effortTrigger().textContent).toBe("Ultra"));
    mockSubscriptionModels(claudeModels);
    await pick(providerTrigger(), "Claude Code (subscription)");
    await waitFor(() => expect(modelTrigger().textContent).toBe("Select Model"));
    expect(effortTrigger()).toBeDisabled();
    await pick(modelTrigger(), "Sonnet");
    await pick(effortTrigger(), "High");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ provider: "claude-code", model: "sonnet", effort: "high" }));
  });

  it("resets effort after a model change and disables it for unsupported models", async () => {
    getUserSettings.mockResolvedValue({ success: true, data: { settings: { ai: { provider: "claude-code", model: "sonnet", effort: "high" } } } });
    mockSubscriptionModels(claudeModels);
    render(<AiSettings />);
    await waitFor(() => expect(effortTrigger().textContent).toBe("High"));
    await pick(modelTrigger(), "Legacy");
    expect(effortTrigger()).toBeDisabled();
    expect(effortTrigger().textContent).toBe("Default");
    expect(screen.getByText("This model does not support an adjustable effort level.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledWith({ provider: "claude-code", model: "legacy", effort: undefined }));
  });

  it("offers a retry for subscription discovery failures and refreshes the CLI catalogue", async () => {
    getUserSettings.mockResolvedValue({ success: true, data: { settings: { ai: { provider: "codex", model: "default" } } } });
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: "Model discovery unavailable" }) })) as unknown as typeof fetch;
    render(<AiSettings />);
    expect(await screen.findByText("Model discovery unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    mockSubscriptionModels();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(modelTrigger().textContent).toBe("Tinyboy default"));
    expect(global.fetch).toHaveBeenCalledWith("/api/ai/subscriptions/models?provider=codex&refresh=1", expect.objectContaining({ signal: expect.anything() }));
  });
});
