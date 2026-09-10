import type {
  BaseEntity,
  CalendarEvent,
  CompletePlanBlockInput,
  CompletionLog,
  CreateInput,
  DailyReview,
  DailyReviewSummary,
  DeviceSettings,
  Goal,
  GoalStep,
  LocalDate,
  PlanBlock,
  UpdateInput,
} from "./models";

export interface EntityRepository<T extends BaseEntity> {
  get(id: string): Promise<T | undefined>;
  list(): Promise<T[]>;
  create(input: CreateInput<T>): Promise<T>;
  update(id: string, changes: UpdateInput<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface TaskDataService {
  goals: EntityRepository<Goal>;
  goalSteps: EntityRepository<GoalStep>;
  calendarEvents: EntityRepository<CalendarEvent>;
  planBlocks: EntityRepository<PlanBlock>;
  completionLogs: EntityRepository<CompletionLog>;
  dailyReviews: EntityRepository<DailyReview>;
  getSettings(): Promise<DeviceSettings>;
  updateSettings(changes: Partial<Omit<DeviceSettings, "id" | "updatedAt">>): Promise<DeviceSettings>;
  completePlanBlock(planBlockId: string, input?: CompletePlanBlockInput): Promise<CompletionLog>;
  getUpcomingReminders(from: Date, days?: number): Promise<CalendarEvent[]>;
  getTodayPlan(date: LocalDate): Promise<PlanBlock[]>;
  getGoalActualMinutes(goalId: string): Promise<number>;
  getCompletionLogs(planBlockId: string): Promise<CompletionLog[]>;
  getDailyReviewSummary(date: LocalDate): Promise<DailyReviewSummary>;
}
