"use client";

import { useState } from "react";
import { GcMonthCalendar, type GcGoal } from "react-goal-calendar";
import { getDailyGoalValues } from "@/actions/dailyGoals.actions";
import { Card } from "@/components/ui/card";
import { DAILY_GOALS } from "@/lib/constants";
import { GOAL_IDS, goalMonthRange, type GoalValues } from "@/lib/dailyGoals";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const GOALS: GcGoal[] = [
  { id: GOAL_IDS.JOBS, label: "Jobs applied", target: DAILY_GOALS.JOBS_TARGET },
  {
    id: GOAL_IDS.HOURS,
    label: "Activity",
    target: DAILY_GOALS.HOURS_TARGET,
    unit: "h",
  },
];

interface DailyGoalsCalendarProps {
  today: string;
  initialValues: GoalValues;
}

export default function DailyGoalsCalendar({
  today,
  initialValues,
}: DailyGoalsCalendarProps) {
  const { minMonth, maxMonth } = goalMonthRange(today);
  const [month, setMonth] = useState(maxMonth);
  const [valuesByMonth, setValuesByMonth] = useState<
    Record<string, GoalValues>
  >({ [maxMonth]: initialValues });
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);

  const handleMonthChange = async (next: string) => {
    setMonth(next);
    if (valuesByMonth[next]) return;
    setLoadingMonth(next);
    const result = await getDailyGoalValues(next);
    if (result.success) {
      setValuesByMonth((prev) => ({ ...prev, [next]: result.data }));
    } else {
      toastError(result.message);
    }
    // A later navigation may already own the busy state
    setLoadingMonth((current) => (current === next ? null : current));
  };

  const loading = loadingMonth === month;

  return (
    <Card
      aria-busy={loading || undefined}
      className={cn("daily-goals-calendar p-4", loading && "opacity-60")}
    >
      <GcMonthCalendar
        goals={GOALS}
        values={valuesByMonth[month]}
        today={today}
        month={month}
        minMonth={minMonth}
        maxMonth={maxMonth}
        onMonthChange={handleMonthChange}
        legend
      />
    </Card>
  );
}
