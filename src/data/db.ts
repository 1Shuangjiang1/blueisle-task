import Dexie, { type EntityTable } from "dexie";
import type {
  CalendarEvent,
  CompletionLog,
  DailyReview,
  DeviceSettings,
  Goal,
  GoalStep,
  PlanBlock,
  SyncConflict,
  SyncMeta,
  SyncOutboxOperation,
  SyncShadow,
} from "../domain/models";
import { seedDemoData } from "./seed";

export class TaskDatabase extends Dexie {
  goals!: EntityTable<Goal, "id">;
  goalSteps!: EntityTable<GoalStep, "id">;
  calendarEvents!: EntityTable<CalendarEvent, "id">;
  planBlocks!: EntityTable<PlanBlock, "id">;
  completionLogs!: EntityTable<CompletionLog, "id">;
  dailyReviews!: EntityTable<DailyReview, "id">;
  deviceSettings!: EntityTable<DeviceSettings, "id">;
  syncOutbox!: EntityTable<SyncOutboxOperation, "opId">;
  syncShadows!: EntityTable<SyncShadow, "id">;
  syncConflicts!: EntityTable<SyncConflict, "id">;
  syncMeta!: EntityTable<SyncMeta, "userId">;

  readonly accountId: string;

  constructor(name = "blueisle-task-next", seedOnReady = true, accountId = "guest") {
    super(name);
    this.accountId = accountId;
    this.version(1).stores({
      goals: "id, status, dueDate, calendarEventId, updatedAt, deletedAt",
      goalSteps: "id, goalId, parentStepId, [goalId+order], updatedAt, deletedAt",
      calendarEvents: "id, startAt, goalId, kind, updatedAt, deletedAt",
      planBlocks: "id, date, status, goalId, goalStepId, [date+order], [date+startMinute], updatedAt, deletedAt",
      completionLogs: "id, planBlockId, goalId, goalStepId, completedAt, updatedAt, deletedAt",
      dailyReviews: "id, date, updatedAt, deletedAt",
      deviceSettings: "id, updatedAt",
    });
    this.version(2).stores({
      goals: "id, status, dueDate, calendarEventId, updatedAt, deletedAt",
      goalSteps: "id, goalId, parentStepId, [goalId+order], updatedAt, deletedAt",
      calendarEvents: "id, startAt, goalId, kind, updatedAt, deletedAt",
      planBlocks: "id, date, status, goalId, goalStepId, [date+order], [date+startMinute], updatedAt, deletedAt",
      completionLogs: "id, planBlockId, goalId, goalStepId, completedAt, updatedAt, deletedAt",
      dailyReviews: "id, date, updatedAt, deletedAt",
      deviceSettings: "id, updatedAt",
      syncOutbox: "opId, userId, entityType, entityId, [userId+entityType+entityId], [userId+status], transactionGroup, createdAt, nextAttemptAt",
      syncShadows: "id, userId, entityType, entityId, [userId+entityType+entityId], updatedAt",
      syncConflicts: "id, userId, entityType, entityId, outboxOpId, [userId+entityType+entityId], resolvedAt, createdAt",
      syncMeta: "userId, updatedAt",
    });
    if (seedOnReady) {
      this.on("ready", async () => {
        await seedDemoData(this);
      });
    }
  }
}

/** The single app database. Import this for Dexie liveQuery subscriptions. */
export const db = new TaskDatabase();

export interface AccountDatabaseOptions {
  /** Demo seed is useful only for the legacy guest database. */
  seedOnReady?: boolean;
  databasePrefix?: string;
}

/**
 * Accounts never share an IndexedDB database. The guest name remains the v1
 * database name so existing local installs are upgraded in place.
 */
export function createAccountDatabase(
  userId: string,
  options: AccountDatabaseOptions = {},
): TaskDatabase {
  const accountId = userId || "guest";
  const prefix = options.databasePrefix ?? "blueisle-task-next";
  const name = accountId === "guest" ? prefix : `${prefix}-user-${accountId}`;
  return new TaskDatabase(
    name,
    options.seedOnReady ?? accountId === "guest",
    accountId,
  );
}

export async function initializeDatabase(): Promise<void> {
  await db.open();
}
