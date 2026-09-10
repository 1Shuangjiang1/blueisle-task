import type {
  CalendarEvent,
  CompletionLog,
  DailyReview,
  DailyReviewSummary,
  Goal,
  GoalStep,
  LocalDate,
  PlanBlock,
  ThemePreference,
} from "../domain/models";
import type { AccountState } from "../auth";
import type { SyncConflict, SyncPhase } from "../sync/types";

export interface GoalProgress {
  value: number;
  label: string;
  actualMinutes?: number;
}

export interface TodayPageProps {
  date: LocalDate;
  reminders: CalendarEvent[];
  planBlocks: PlanBlock[];
  goals: Goal[];
  steps: GoalStep[];
  onAddPlan?: (preset?: Partial<PlanBlock>) => void;
  onEditPlan?: (plan: PlanBlock) => void;
  onCompletePlan?: (plan: PlanBlock) => void;
  onOpenGoal?: (goalId: string) => void;
}

export interface PlanningPageProps {
  month: Date;
  events: CalendarEvent[];
  goals: Goal[];
  goalProgress?: Record<string, GoalProgress>;
  onMonthChange?: (month: Date) => void;
  onAddEvent?: () => void;
  onOpenEvent?: (event: CalendarEvent) => void;
  onAddGoal?: () => void;
  onOpenGoal?: (goalId: string) => void;
}

export interface GoalsPageProps {
  goals: Goal[];
  goalProgress?: Record<string, GoalProgress>;
  onAddGoal?: () => void;
  onOpenGoal?: (goalId: string) => void;
}

export interface GoalDetailPageProps {
  goal: Goal;
  steps: GoalStep[];
  planBlocks: PlanBlock[];
  completionLogs: CompletionLog[];
  progress?: GoalProgress;
  onBack?: () => void;
  onDeleteGoal?: () => void;
  onAddStep?: (parentStepId?: string) => void;
  onEditStep?: (step: GoalStep) => void;
  onToggleStep?: (step: GoalStep) => void;
  onAddPlan?: (preset?: Partial<PlanBlock>) => void;
}

export interface ReviewPageProps {
  summary: DailyReviewSummary;
  planBlocks: PlanBlock[];
  onChangeDate?: (date: LocalDate) => void;
  onSaveReview?: (
    changes: Pick<DailyReview, "reflection" | "blockers" | "tomorrowFocus">,
  ) => void;
  onReschedule?: (
    plan: PlanBlock,
    action: "tomorrow" | "date" | "backlog" | "cancel",
  ) => void;
}

export interface SettingsPanelProps {
  theme: ThemePreference;
  reduceMotion: boolean;
  syncState?: "synced" | "pending" | "offline" | "error";
  account?: AccountState;
  sync?: SyncControlState;
  onThemeChange?: (theme: ThemePreference) => void;
  onReduceMotionChange?: (value: boolean) => void;
  onExport?: () => void;
  onImport?: (file: File) => void;
  backupRestoreDisabled?: boolean;
  backupRestoreHint?: string;
  onCheckUpdate?: () => void;
  onSignIn?: (email: string, password: string) => Promise<void>;
  onSignUp?: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  onSignOut?: () => Promise<void>;
  onSyncNow?: () => Promise<void>;
  onResolveConflict?: (conflict: SyncConflict, choice: SyncConflictResolution) => Promise<void>;
  onClose?: () => void;
}

export type SyncConflictResolution = "local" | "remote" | "merge";

export interface SyncControlState {
  readonly phase: SyncPhase;
  readonly pendingCount: number;
  readonly conflicts: readonly SyncConflict[];
  readonly lastSuccessAt: string | null;
  readonly error: string | null;
}

export interface SyncConflictPanelProps {
  readonly conflicts: readonly SyncConflict[];
  readonly resolvingId?: string | null;
  readonly onResolve?: (conflict: SyncConflict, choice: SyncConflictResolution) => void;
}
