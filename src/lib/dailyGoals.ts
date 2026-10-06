import { format } from "date-fns";
import { DAILY_GOALS } from "@/lib/constants";

// Directive-free: imported by the server action and the client calendar.

export type GoalValues = Record<string, Record<string, number>>;

export const GOAL_IDS = { JOBS: "jobs", HOURS: "hours" } as const;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(month: unknown): month is string {
  return typeof month === "string" && MONTH_PATTERN.test(month);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return format(new Date(year, monthIndex - 1 + delta, 1), "yyyy-MM");
}

export function monthBounds(month: string): { start: Date; end: Date } {
  const [year, monthIndex] = month.split("-").map(Number);
  return {
    start: new Date(year, monthIndex - 1, 1, 0, 0, 0, 0),
    // Day 0 of the next month is the last day of this one
    end: new Date(year, monthIndex, 0, 23, 59, 59, 999),
  };
}

export function goalMonthRange(today: string): {
  minMonth: string;
  maxMonth: string;
} {
  const maxMonth = today.slice(0, 7);
  return {
    minMonth: shiftMonth(maxMonth, -DAILY_GOALS.MONTHS_BACK),
    maxMonth,
  };
}

export function buildGoalValues(
  jobs: { appliedDate: Date | null; _count: { _all: number } }[],
  activities: { startTime: Date; duration: number | null }[],
): GoalValues {
  const minutes: Record<string, number> = {};
  const values: GoalValues = {};
  const day = (key: string) =>
    (values[key] ??= { [GOAL_IDS.JOBS]: 0, [GOAL_IDS.HOURS]: 0 });

  for (const job of jobs) {
    if (!job.appliedDate) continue;
    day(format(job.appliedDate, "yyyy-MM-dd"))[GOAL_IDS.JOBS] +=
      job._count._all;
  }
  for (const activity of activities) {
    if (activity.duration === null) continue;
    const key = format(activity.startTime, "yyyy-MM-dd");
    day(key);
    minutes[key] = (minutes[key] ?? 0) + activity.duration;
  }
  // Round once per day so summed fractions don't drift
  for (const [key, total] of Object.entries(minutes)) {
    values[key][GOAL_IDS.HOURS] = Math.round((total / 60) * 10) / 10;
  }
  return values;
}
