import {
  buildGoalValues,
  goalMonthRange,
  isValidMonth,
  monthBounds,
  shiftMonth,
} from "@/lib/dailyGoals";

describe("dailyGoals helpers", () => {
  describe("isValidMonth", () => {
    it.each(["2026-10", "2025-01", "2026-12"])("accepts %s", (m) => {
      expect(isValidMonth(m)).toBe(true);
    });
    it.each(["2026-13", "2026-00", "2026-1", "abc", "", 202610, null])(
      "rejects %s",
      (m) => {
        expect(isValidMonth(m)).toBe(false);
      },
    );
  });

  describe("shiftMonth", () => {
    it("crosses the year boundary backwards and forwards", () => {
      expect(shiftMonth("2026-01", -1)).toBe("2025-12");
      expect(shiftMonth("2025-12", 1)).toBe("2026-01");
      expect(shiftMonth("2026-10", -11)).toBe("2025-11");
    });
  });

  describe("monthBounds", () => {
    it("spans the first to the last local day of the month", () => {
      const { start, end } = monthBounds("2024-02");
      expect(start).toEqual(new Date(2024, 1, 1, 0, 0, 0, 0));
      expect(end).toEqual(new Date(2024, 1, 29, 23, 59, 59, 999));
    });
  });

  describe("goalMonthRange", () => {
    it("covers the current month and the 11 before it", () => {
      expect(goalMonthRange("2026-10-05")).toEqual({
        minMonth: "2025-11",
        maxMonth: "2026-10",
      });
    });
  });

  describe("buildGoalValues", () => {
    it("sums jobs per applied day and hours per start day", () => {
      const result = buildGoalValues(
        [
          { appliedDate: new Date(2026, 9, 1, 9), _count: { _all: 2 } },
          { appliedDate: new Date(2026, 9, 1, 15), _count: { _all: 1 } },
          { appliedDate: new Date(2026, 9, 2, 9), _count: { _all: 4 } },
        ],
        [
          { startTime: new Date(2026, 9, 1, 10), duration: 90 },
          { startTime: new Date(2026, 9, 1, 13), duration: 45 },
          { startTime: new Date(2026, 9, 3, 8), duration: 20 },
        ],
      );
      expect(result).toEqual({
        "2026-10-01": { jobs: 3, hours: 2.3 },
        "2026-10-02": { jobs: 4, hours: 0 },
        "2026-10-03": { jobs: 0, hours: 0.3 },
      });
    });

    it("skips undated jobs and unfinished activities", () => {
      expect(
        buildGoalValues(
          [{ appliedDate: null, _count: { _all: 5 } }],
          [{ startTime: new Date(2026, 9, 1, 10), duration: null }],
        ),
      ).toEqual({});
    });
  });
});
