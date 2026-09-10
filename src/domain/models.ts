import type {
  EntityType,
  OutboxOp,
  SyncConflict as EngineSyncConflict,
  SyncMeta as EngineSyncMeta,
  SyncShadow as EngineSyncShadow,
} from "../sync/types";

/** ISO dates are stored as strings so they survive IndexedDB and future sync unchanged. */
export type ISODateTime = string;
export type LocalDate = `${number}-${number}-${number}`;

export interface BaseEntity {
  id: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  entityVersion: number;
  deletedAt?: ISODateTime;
}

export type GoalStatus = "active" | "paused" | "completed" | "archived";

export interface Goal extends BaseEntity {
  title: string;
  description?: string;
  status: GoalStatus;
  color?: string;
  dueDate?: LocalDate;
  /** A Goal can reference its most relevant calendar event without making either mandatory. */
  calendarEventId?: string;
}

export type GoalStepProgressKind = "binary" | "manual" | "count";

export interface GoalStep extends BaseEntity {
  goalId: string;
  parentStepId?: string;
  title: string;
  notes?: string;
  order: number;
  progressKind: GoalStepProgressKind;
  progressValue: number;
  progressTarget?: number;
  isCompleted: boolean;
  completedAt?: ISODateTime;
}

export type CalendarEventKind =
  | "interview"
  | "assessment"
  | "deadline"
  | "personal"
  | "other";

export interface CalendarEvent extends BaseEntity {
  title: string;
  kind: CalendarEventKind;
  startAt: ISODateTime;
  endAt?: ISODateTime;
  timezone: string;
  isAllDay: boolean;
  notes?: string;
  goalId?: string;
}

export type PlanBlockStatus = "planned" | "completed" | "cancelled";

export interface PlanBlock extends BaseEntity {
  date: LocalDate;
  title: string;
  startMinute?: number;
  endMinute?: number;
  status: PlanBlockStatus;
  goalId?: string;
  goalStepId?: string;
  notes?: string;
  /** Visual order for unscheduled items and equal-time blocks. */
  order: number;
}

export interface CompletionLog extends BaseEntity {
  planBlockId: string;
  goalId?: string;
  goalStepId?: string;
  completedAt: ISODateTime;
  actualMinutes?: number;
  outcome?: string;
  notes?: string;
  nextStep?: string;
}

export interface DailyReview extends BaseEntity {
  date: LocalDate;
  reflection?: string;
  blockers?: string;
  tomorrowFocus?: string;
}

export type ThemePreference = "light" | "cyber" | "system";

export interface DeviceSettings {
  id: "device-settings";
  theme: ThemePreference;
  reduceMotion: boolean;
  reminderDays: number;
  updatedAt: ISODateTime;
}

export type EntityName =
  | "goals"
  | "goalSteps"
  | "calendarEvents"
  | "planBlocks"
  | "completionLogs"
  | "dailyReviews";

/** Syncable business records. Device settings deliberately remain local. */
export type SyncEntity =
  | Goal
  | GoalStep
  | CalendarEvent
  | PlanBlock
  | CompletionLog
  | DailyReview;

/**
 * Append-only mutation payload. Retry bookkeeping is mutable, while the
 * snapshot, operation id and predecessor are never rewritten.
 */
export type SyncOutboxOperation = OutboxOp & {
  transactionGroup?: string;
};

export type SyncShadow = EngineSyncShadow & { id: string };
export type SyncConflict = EngineSyncConflict;
export type SyncMeta = EngineSyncMeta;
export type SyncEntityType = EntityType;

export type CreateInput<T extends BaseEntity> = Omit<T, keyof BaseEntity> & {
  id?: string;
};

export type UpdateInput<T extends BaseEntity> = Partial<
  Omit<T, keyof BaseEntity>
>;

export interface CompletePlanBlockInput {
  actualMinutes?: number;
  outcome?: string;
  notes?: string;
  nextStep?: string;
  completedAt?: ISODateTime;
}

export interface DailyReviewSummary {
  date: LocalDate;
  plannedCount: number;
  completedCount: number;
  remainingCount: number;
  actualMinutes: number;
  completionLogs: CompletionLog[];
  review?: DailyReview;
}

export interface BackupPayload {
  version: 1;
  exportedAt: ISODateTime;
  goals: Goal[];
  steps: GoalStep[];
  events: CalendarEvent[];
  plans: PlanBlock[];
  logs: CompletionLog[];
  reviews: DailyReview[];
}
