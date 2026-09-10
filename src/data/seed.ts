import type { TaskDatabase } from "./db";
import type { CalendarEvent, Goal, GoalStep, PlanBlock } from "../domain/models";

const todayLocal = (): `${number}-${number}-${number}` => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10) as `${number}-${number}-${number}`;
};

const plusDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

/** Adds useful sample data exactly once, only to an empty database. */
export async function seedDemoData(database: TaskDatabase): Promise<void> {
  // A goal-only test can accidentally seed a partially restored account. Seed
  // only when every business table is empty; signed-in account databases turn
  // seeding off at factory creation time.
  const counts = await Promise.all([
    database.goals.count(),
    database.goalSteps.count(),
    database.calendarEvents.count(),
    database.planBlocks.count(),
    database.completionLogs.count(),
    database.dailyReviews.count(),
  ]);
  if (counts.some((count) => count > 0)) return;
  const now = new Date().toISOString();
  const date = todayLocal();
  const interviewAt = plusDays(3).toISOString();
  const goal: Goal = {
    id: "seed-huawei-assessment",
    title: "准备华为笔试",
    description: "围绕算法题、选择题和限时模拟做准备。",
    status: "active",
    color: "cyan",
    dueDate: plusDays(3).toISOString().slice(0, 10) as `${number}-${number}-${number}`,
    calendarEventId: "seed-huawei-event",
    createdAt: now,
    updatedAt: now,
    entityVersion: 1,
  };
  const event: CalendarEvent = {
    id: "seed-huawei-event",
    title: "华为笔试",
    kind: "assessment",
    startAt: interviewAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    isAllDay: false,
    goalId: goal.id,
    createdAt: now,
    updatedAt: now,
    entityVersion: 1,
  };
  const step: GoalStep = {
    id: "seed-simulation-step",
    goalId: goal.id,
    title: "模拟类算法题",
    order: 0,
    progressKind: "count",
    progressValue: 0,
    progressTarget: 10,
    isCompleted: false,
    createdAt: now,
    updatedAt: now,
    entityVersion: 1,
  };
  const plan: PlanBlock = {
    id: "seed-today-simulation",
    date,
    title: "模拟题训练",
    startMinute: 14 * 60,
    endMinute: 16 * 60,
    status: "planned",
    goalId: goal.id,
    goalStepId: step.id,
    notes: "专注字符串解析与模拟。",
    order: 0,
    createdAt: now,
    updatedAt: now,
    entityVersion: 1,
  };
  await database.transaction("rw", database.goals, database.calendarEvents, database.goalSteps, database.planBlocks, async () => {
    await database.goals.add(goal);
    await database.calendarEvents.add(event);
    await database.goalSteps.add(step);
    await database.planBlocks.add(plan);
  });
}
