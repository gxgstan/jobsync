import { getDailyGoalValues } from "@/actions/dailyGoals.actions";
import { getCurrentUser } from "@/utils/user.utils";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

vi.mock("@prisma/client", () => {
  const mPrismaClient = {
    job: { groupBy: vi.fn() },
    activity: { findMany: vi.fn() },
  };
  return { PrismaClient: vi.fn(function () { return mPrismaClient; }) };
});

vi.mock("@/utils/user.utils", () => ({
  getCurrentUser: vi.fn(),
}));

describe("getDailyGoalValues", () => {
  const mockUser = { id: "user-id" };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    (getCurrentUser as any).mockResolvedValue(mockUser);
    (prisma.job.groupBy as any).mockResolvedValue([]);
    (prisma.activity.findMany as any).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scopes both queries to the user and the month", async () => {
    (prisma.job.groupBy as any).mockResolvedValue([
      { appliedDate: new Date(2026, 8, 2, 9), _count: { _all: 3 } },
    ]);
    (prisma.activity.findMany as any).mockResolvedValue([
      { startTime: new Date(2026, 8, 2, 10), duration: 150 },
    ]);

    const result = await getDailyGoalValues("2026-09");

    const range = {
      gte: new Date(2026, 8, 1, 0, 0, 0, 0),
      lte: new Date(2026, 8, 30, 23, 59, 59, 999),
    };
    expect(prisma.job.groupBy).toHaveBeenCalledWith({
      by: "appliedDate",
      _count: { _all: true },
      where: { userId: "user-id", applied: true, appliedDate: range },
    });
    expect(prisma.activity.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-id",
        startTime: range,
        duration: { not: null },
      },
      select: { startTime: true, duration: true },
    });
    expect(result).toEqual({
      success: true,
      data: { "2026-09-02": { jobs: 3, hours: 2.5 } },
    });
  });

  it.each(["2026-13", "abc", "2026-11", "2025-10"])(
    "rejects %s without querying",
    async (month) => {
      const result = await getDailyGoalValues(month);
      expect(result).toEqual({ success: false, message: "Invalid month." });
      expect(prisma.job.groupBy).not.toHaveBeenCalled();
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
    },
  );

  it("accepts the oldest browsable month", async () => {
    const result = await getDailyGoalValues("2025-11");
    expect(result.success).toBe(true);
  });

  it("returns a failure when not signed in", async () => {
    (getCurrentUser as any).mockResolvedValue(null);
    const result = await getDailyGoalValues("2026-10");
    expect(result).toEqual({ success: false, message: "Not authenticated" });
  });
});
