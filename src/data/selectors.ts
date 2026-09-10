import { liveQuery, type Observable } from "dexie";
import type { CalendarEvent, CompletionLog, DailyReviewSummary, LocalDate, PlanBlock } from "../domain/models";
import { taskService, type TaskService } from "./service";

export const selectUpcomingReminders = (from: Date, days = 7, service: TaskService = taskService): Promise<CalendarEvent[]> =>
  service.getUpcomingReminders(from, days);

export const selectTodayPlan = (date: LocalDate, service: TaskService = taskService): Promise<PlanBlock[]> => service.getTodayPlan(date);

export const selectGoalActualMinutes = (goalId: string, service: TaskService = taskService): Promise<number> =>
  service.getGoalActualMinutes(goalId);

export const selectCompletionLogs = (planBlockId: string, service: TaskService = taskService): Promise<CompletionLog[]> =>
  service.getCompletionLogs(planBlockId);

export const selectDailyReviewSummary = (date: LocalDate, service: TaskService = taskService): Promise<DailyReviewSummary> =>
  service.getDailyReviewSummary(date);

/** React can subscribe directly with `useSyncExternalStore`, without another dependency. */
export function observeTodayPlan(date: LocalDate, service: TaskService = taskService): Observable<PlanBlock[]> {
  return liveQuery(() => service.getTodayPlan(date));
}

export function observeDailyReviewSummary(date: LocalDate, service: TaskService = taskService): Observable<DailyReviewSummary> {
  return liveQuery(() => service.getDailyReviewSummary(date));
}
