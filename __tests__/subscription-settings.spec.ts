import { getUserSettings, updateAiSettings } from "@/actions/userSettings.actions";

const store = vi.hoisted(() => ({ settings: "" }));
const db = vi.hoisted(() => ({ userSettings: { findUnique: vi.fn(), upsert: vi.fn() } }));
vi.mock("@/lib/db", () => ({ default: db }));
vi.mock("@/actions/shared", () => ({ requireUser: vi.fn(async () => ({ id: "user-1" })) }));

describe("subscription settings persistence", () => {
  beforeEach(() => {
    store.settings = JSON.stringify({ ai: { provider: "codex", model: "default" }, display: { theme: "dark" } });
    db.userSettings.findUnique.mockImplementation(async () => ({ userId: "user-1", settings: store.settings }));
    db.userSettings.upsert.mockImplementation(async ({ update }: { update: { settings: string } }) => {
      store.settings = update.settings;
      return { userId: "user-1", settings: store.settings };
    });
  });

  it("persists model and effort together, reloads them, and can reset to the model default", async () => {
    const chosen = { provider: "codex", model: "model-a", effort: "high" } as const;
    expect((await updateAiSettings(chosen as Parameters<typeof updateAiSettings>[0])).success).toBe(true);
    expect((await getUserSettings()).data.settings).toMatchObject({ ai: chosen, display: { theme: "dark" } });
    expect(db.userSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
    await updateAiSettings({ ...chosen, effort: undefined } as Parameters<typeof updateAiSettings>[0]);
    expect((await getUserSettings()).data.settings.ai).not.toHaveProperty("effort");
  });
});
