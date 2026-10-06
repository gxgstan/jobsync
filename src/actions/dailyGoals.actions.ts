"use server";

import { format } from "date-fns";
import prisma from "@/lib/db";
import { handleError } from "@/lib/utils";
import { requireUser } from "@/actions/shared";
import {
  buildGoalValues,
  goalMonthRange,
  isValidMonth,
  monthBounds,
  type GoalValues,
} from "@/lib/dailyGoals";

export async function getDailyGoalValues(
  month: string,
): Promise<
  { success: true; data: GoalValues } | { success: false; message: string }
> {
  try {
    const user = await requireUser();
    const { minMonth, maxMonth } = goalMonthRange(
      format(new Date(), "yyyy-MM-dd"),
    );
    // Client-supplied: only the browsable window is queryable
    if (!isValidMonth(month) || month < minMonth || month > maxMonth) {
      return { success: false, message: "Invalid month." };
    }
    const { start, end } = monthBounds(month);
    const range = { gte: start, lte: end };
    const [jobs, activities] = await Promise.all([
      prisma.job.groupBy({
        by: "appliedDate",
        _count: { _all: true },
        where: { userId: user.id, applied: true, appliedDate: range },
      }),
      prisma.activity.findMany({
        where: {
          userId: user.id,
          startTime: range,
          duration: { not: null },
        },
        select: { startTime: true, duration: true },
      }),
    ]);
    return { success: true, data: buildGoalValues(jobs, activities) };
  } catch (error) {
    // handleError types success as boolean; re-wrap to keep the union narrow.
    const { message } = handleError(error, "Failed to load daily goals.");
    return { success: false, message };
  }
}
