import { db, type TaskDatabase } from "./db";
import type {
  BaseEntity,
  BackupPayload,
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
  EntityName,
  SyncEntity,
  SyncOutboxOperation,
  UpdateInput,
} from "../domain/models";
import type { EntityRepository, TaskDataService } from "../domain/repository";
import type { JsonObject } from "../sync/types";
import { createUuidV4 } from "../utils/uuid";

const SETTINGS_ID = "device-settings" as const;

const makeId = createUuidV4;
// Outbox ordering must stay stable when two local writes happen in one clock
// millisecond. ISO timestamps remain sortable across restarts; this small
// process-local monotonic guard disambiguates writes from the current runtime.
let latestTimestamp = 0;
const now = () => {
  const timestamp = Math.max(Date.now(), latestTimestamp + 1);
  latestTimestamp = timestamp;
  return new Date(timestamp).toISOString();
};

function visible<T extends BaseEntity>(item: T | undefined): item is T {
  return Boolean(item && !item.deletedAt);
}

function jsonSnapshot<T extends object>(item: T): JsonObject {
  const cloned = typeof structuredClone === "function"
    ? structuredClone(item)
    : JSON.parse(JSON.stringify(item));
  return cloned as JsonObject;
}

/**
 * Validates an entity's outbox graph and returns its unique tail. Every
 * mutation must form one immutable predecessor chain. Timestamp order cannot
 * establish that property because clocks can move backwards and separate app
 * instances can write in the same millisecond.
 */
function findUniqueOutboxTail(
  operations: readonly SyncOutboxOperation[],
): SyncOutboxOperation | undefined {
  if (operations.length === 0) return undefined;

  const byId = new Map(operations.map((operation) => [operation.opId, operation]));
  if (byId.size !== operations.length) {
    throw new Error("同步队列异常：存在重复操作 ID");
  }

  const successorCounts = new Map<string, number>();
  const roots: SyncOutboxOperation[] = [];
  for (const operation of operations) {
    if (!operation.predecessorOpId) {
      roots.push(operation);
      continue;
    }
    if (!byId.has(operation.predecessorOpId)) {
      throw new Error("同步队列异常：操作前置记录缺失");
    }
    const count = (successorCounts.get(operation.predecessorOpId) ?? 0) + 1;
    if (count > 1) throw new Error("同步队列异常：操作链出现分叉");
    successorCounts.set(operation.predecessorOpId, count);
  }
  if (roots.length !== 1) {
    throw new Error("同步队列异常：操作链必须只有一个起点");
  }

  const seen = new Set<string>();
  let current = roots[0]!;
  while (true) {
    if (seen.has(current.opId)) throw new Error("同步队列异常：操作链出现环");
    seen.add(current.opId);
    const successor = operations.find((operation) => operation.predecessorOpId === current.opId);
    if (!successor) break;
    current = successor;
  }
  if (seen.size !== operations.length) {
    throw new Error("同步队列异常：操作链不连通");
  }
  return current;
}

type EntityStore<T extends BaseEntity> = {
  get(key: string): Promise<T | undefined>;
  toArray(): Promise<T[]>;
  add(item: T): Promise<unknown>;
  put(item: T): Promise<unknown>;
};

/** Must be called from the same Dexie transaction as the business write. */
export async function appendSyncOutbox<T extends SyncEntity>(
  database: TaskDatabase,
  entityType: EntityName,
  item: T,
  transactionGroup?: string,
): Promise<SyncOutboxOperation> {
  const userId = database.accountId;
  const shadow = await database.syncShadows
    .where("[userId+entityType+entityId]")
    .equals([userId, entityType, item.id])
    .first();
  const chain = await database.syncOutbox
    .where("[userId+entityType+entityId]")
    .equals([userId, entityType, item.id])
    .toArray();
  const tail = findUniqueOutboxTail(chain);
  const operation: SyncOutboxOperation = {
    opId: makeId(),
    userId,
    entityType,
    entityId: item.id,
    baseServerVersion: shadow?.serverVersion ?? null,
    baseSnapshot: shadow?.snapshot ?? null,
    desiredSnapshot: item.deletedAt ? null : jsonSnapshot(item),
    predecessorOpId: tail?.opId ?? null,
    transactionGroup,
    createdAt: now(),
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
  };
  await database.syncOutbox.add(operation);
  return operation;
}

class DexieEntityRepository<T extends SyncEntity>
  implements EntityRepository<T>
{
  constructor(
    private readonly database: TaskDatabase,
    private readonly table: EntityStore<T>,
    private readonly entityType: EntityName,
  ) {}

  private async appendOutbox(
    item: T,
    transactionGroup?: string,
  ): Promise<SyncOutboxOperation> {
    return appendSyncOutbox(this.database, this.entityType, item, transactionGroup);
  }

  async get(id: string): Promise<T | undefined> {
    const item = await this.table.get(id);
    return visible(item) ? item : undefined;
  }

  async list(): Promise<T[]> {
    return (await this.table.toArray()).filter(visible);
  }

  async create(input: CreateInput<T>): Promise<T> {
    const timestamp = now();
    const item = {
      ...input,
      id: input.id ?? makeId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      entityVersion: 1,
    } as T;
    await this.database.transaction(
      "rw",
      [this.table as never, this.database.syncOutbox, this.database.syncShadows],
      async () => {
        await this.table.add(item);
        await this.appendOutbox(item);
      },
    );
    return item;
  }

  async update(id: string, changes: UpdateInput<T>): Promise<T> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Entity not found: ${id}`);
    const item = {
      ...existing,
      ...changes,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now(),
      entityVersion: existing.entityVersion + 1,
    } as T;
    await this.database.transaction(
      "rw",
      [this.table as never, this.database.syncOutbox, this.database.syncShadows],
      async () => {
        await this.table.put(item);
        await this.appendOutbox(item);
      },
    );
    return item;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    const timestamp = now();
    const item = {
      ...existing,
      deletedAt: timestamp,
      updatedAt: timestamp,
      entityVersion: existing.entityVersion + 1,
    } as T;
    await this.database.transaction(
      "rw",
      [this.table as never, this.database.syncOutbox, this.database.syncShadows],
      async () => {
        await this.table.put(item);
        await this.appendOutbox(item);
      },
    );
  }
}

export interface TaskService extends TaskDataService {
  createGoal(
    input: Pick<CreateInput<Goal>, "title"> &
      Partial<Omit<CreateInput<Goal>, "title" | "status">>,
  ): Promise<Goal>;
  createGoalStep(
    input: Pick<CreateInput<GoalStep>, "goalId" | "title"> &
      Partial<
        Omit<
          CreateInput<GoalStep>,
          | "goalId"
          | "title"
          | "order"
          | "progressKind"
          | "progressValue"
          | "isCompleted"
        >
      >,
  ): Promise<GoalStep>;
  createCalendarEvent(
    input: Pick<CreateInput<CalendarEvent>, "title" | "startAt"> &
      Partial<
        Omit<
          CreateInput<CalendarEvent>,
          "title" | "startAt" | "kind" | "timezone" | "isAllDay"
        >
      >,
  ): Promise<CalendarEvent>;
  createPlanBlock(
    input: Pick<CreateInput<PlanBlock>, "date" | "title"> &
      Partial<Omit<CreateInput<PlanBlock>, "date" | "title" | "status">>,
  ): Promise<PlanBlock>;
  updatePlanBlock(
    id: string,
    changes: UpdateInput<PlanBlock>,
  ): Promise<PlanBlock>;
  upsertDailyReview(
    date: LocalDate,
    changes: Omit<Partial<DailyReview>, keyof BaseEntity | "date">,
  ): Promise<DailyReview>;
  exportBackup(): Promise<BackupPayload>;
  importBackup(payload: unknown): Promise<void>;
}

function assertPlanTime(
  input: Pick<PlanBlock, "startMinute" | "endMinute">,
): void {
  const validMinute = (value: number | undefined) =>
    value === undefined ||
    (Number.isInteger(value) && value >= 0 && value <= 1440);
  if (!validMinute(input.startMinute) || !validMinute(input.endMinute))
    throw new Error("时间必须在当天 00:00 到 24:00 之间");
  if (
    input.startMinute !== undefined &&
    input.endMinute !== undefined &&
    input.endMinute <= input.startMinute
  )
    throw new Error("结束时间必须晚于开始时间");
}

function parseBackup(payload: unknown): BackupPayload {
  if (!payload || typeof payload !== "object")
    throw new Error("备份文件格式不正确");
  const value = payload as Partial<BackupPayload>;
  const lists = [
    value.goals,
    value.steps,
    value.events,
    value.plans,
    value.logs,
    value.reviews,
  ];
  if (value.version !== 1 || lists.some((list) => !Array.isArray(list)))
    throw new Error("不支持的备份版本或数据不完整");
  for (const list of lists as BaseEntity[][]) {
    if (
      list.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.createdAt !== "string" ||
          typeof item.updatedAt !== "string" ||
          typeof item.entityVersion !== "number",
      )
    )
      throw new Error("备份中含有无效记录");
  }
  for (const plan of value.plans!) assertPlanTime(plan);
  return value as BackupPayload;
}

export function createTaskService(database: TaskDatabase = db): TaskService {
  const service: TaskService = {
    goals: new DexieEntityRepository<Goal>(
      database,
      database.goals as unknown as EntityStore<Goal>,
      "goals",
    ),
    goalSteps: new DexieEntityRepository<GoalStep>(
      database,
      database.goalSteps as unknown as EntityStore<GoalStep>,
      "goalSteps",
    ),
    calendarEvents: new DexieEntityRepository<CalendarEvent>(
      database,
      database.calendarEvents as unknown as EntityStore<CalendarEvent>,
      "calendarEvents",
    ),
    planBlocks: new DexieEntityRepository<PlanBlock>(
      database,
      database.planBlocks as unknown as EntityStore<PlanBlock>,
      "planBlocks",
    ),
    completionLogs: new DexieEntityRepository<CompletionLog>(
      database,
      database.completionLogs as unknown as EntityStore<CompletionLog>,
      "completionLogs",
    ),
    dailyReviews: new DexieEntityRepository<DailyReview>(
      database,
      database.dailyReviews as unknown as EntityStore<DailyReview>,
      "dailyReviews",
    ),

    async createGoal(input) {
      return service.goals.create({ status: "active", ...input });
    },
    async createGoalStep(input) {
      return service.goalSteps.create({
        order: 0,
        progressKind: "binary",
        progressValue: 0,
        isCompleted: false,
        ...input,
      });
    },
    async createCalendarEvent(input) {
      return service.calendarEvents.create({
        kind: "other",
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        isAllDay: false,
        ...input,
      });
    },
    async createPlanBlock(input) {
      const value = { status: "planned" as const, order: 0, ...input };
      assertPlanTime(value);
      return service.planBlocks.create(value);
    },
    async updatePlanBlock(id, changes) {
      const current = await service.planBlocks.get(id);
      if (!current) throw new Error(`Plan block not found: ${id}`);
      assertPlanTime({ ...current, ...changes });
      return service.planBlocks.update(id, changes);
    },
    async getSettings() {
      const existing = await database.deviceSettings.get(SETTINGS_ID);
      if (existing) return existing;
      const created: DeviceSettings = {
        id: SETTINGS_ID,
        theme: "system",
        reduceMotion: false,
        reminderDays: 7,
        updatedAt: now(),
      };
      await database.deviceSettings.put(created);
      return created;
    },
    async updateSettings(changes) {
      const settings = await service.getSettings();
      const updated = {
        ...settings,
        ...changes,
        id: SETTINGS_ID,
        updatedAt: now(),
      };
      await database.deviceSettings.put(updated);
      return updated;
    },
    async completePlanBlock(planBlockId, input: CompletePlanBlockInput = {}) {
      return database.transaction(
        "rw",
        database.planBlocks,
        database.completionLogs,
        database.syncOutbox,
        database.syncShadows,
        async () => {
          const block = await database.planBlocks.get(planBlockId);
          if (!visible(block))
            throw new Error(`Plan block not found: ${planBlockId}`);
          if (block.status === "cancelled")
            throw new Error("已取消的安排不能标记为完成");
          if (
            input.actualMinutes !== undefined &&
            (!Number.isFinite(input.actualMinutes) || input.actualMinutes < 0)
          )
            throw new Error("实际投入不能为负数");
          const completionId = `completion:${planBlockId}`;
          const existing = visible(await database.completionLogs.get(completionId))
            ? await database.completionLogs.get(completionId)
            : (
                await database.completionLogs
                  .where("planBlockId")
                  .equals(planBlockId)
                  .toArray()
              ).find(visible);
          if (existing) return existing;
          const completedAt = input.completedAt ?? now();
          const log: CompletionLog = {
            id: completionId,
            planBlockId,
            goalId: block.goalId,
            goalStepId: block.goalStepId,
            completedAt,
            actualMinutes: input.actualMinutes,
            outcome: input.outcome,
            notes: input.notes,
            nextStep: input.nextStep,
            createdAt: completedAt,
            updatedAt: completedAt,
            entityVersion: 1,
          };
          const updatedBlock: PlanBlock = {
            ...block,
            status: "completed",
            updatedAt: completedAt,
            entityVersion: block.entityVersion + 1,
          };
          const transactionGroup = makeId();
          await database.completionLogs.add(log);
          await database.planBlocks.put(updatedBlock);
          await appendSyncOutbox(database, "planBlocks", updatedBlock, transactionGroup);
          await appendSyncOutbox(database, "completionLogs", log, transactionGroup);
          return log;
        },
      );
    },
    async getUpcomingReminders(from, days = 7) {
      const start = from.getTime();
      const end = start + days * 24 * 60 * 60 * 1000;
      return (await database.calendarEvents.toArray())
        .filter(visible)
        .filter((event) => {
          const time = new Date(event.startAt).getTime();
          return time >= start && time <= end;
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt));
    },
    async getTodayPlan(date) {
      return (await database.planBlocks.where("date").equals(date).toArray())
        .filter(visible)
        .sort(
          (a, b) =>
            (a.startMinute ?? Number.MAX_SAFE_INTEGER) -
              (b.startMinute ?? Number.MAX_SAFE_INTEGER) || a.order - b.order,
        );
    },
    async getGoalActualMinutes(goalId) {
      return (
        await database.completionLogs.where("goalId").equals(goalId).toArray()
      )
        .filter(visible)
        .reduce((total, log) => total + (log.actualMinutes ?? 0), 0);
    },
    async getCompletionLogs(planBlockId) {
      return (
        await database.completionLogs
          .where("planBlockId")
          .equals(planBlockId)
          .toArray()
      )
        .filter(visible)
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    },
    async getDailyReviewSummary(date) {
      const blocks = await service.getTodayPlan(date);
      const blockIds = new Set(blocks.map((block) => block.id));
      const logs = (await database.completionLogs.toArray())
        .filter(visible)
        .filter((log) => blockIds.has(log.planBlockId))
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      const review = await database.dailyReviews
        .where("date")
        .equals(date)
        .first();
      return {
        date,
        plannedCount: blocks.length,
        completedCount: blocks.filter((block) => block.status === "completed")
          .length,
        remainingCount: blocks.filter((block) => block.status === "planned")
          .length,
        actualMinutes: logs.reduce(
          (total, log) => total + (log.actualMinutes ?? 0),
          0,
        ),
        completionLogs: logs,
        review: visible(review) ? review : undefined,
      };
    },
    async upsertDailyReview(date, changes) {
      const deterministicId = `daily-review:${date}`;
      const existing = await database.dailyReviews.get(deterministicId);
      if (visible(existing))
        return service.dailyReviews.update(existing.id, changes);
      const legacy = (await database.dailyReviews.where("date").equals(date).toArray())
        .find(visible);
      if (legacy) return service.dailyReviews.update(legacy.id, changes);
      return service.dailyReviews.create({ id: deterministicId, date, ...changes });
    },
    async exportBackup() {
      const [goals, steps, events, plans, logs, reviews] = await Promise.all([
        service.goals.list(),
        service.goalSteps.list(),
        service.calendarEvents.list(),
        service.planBlocks.list(),
        service.completionLogs.list(),
        service.dailyReviews.list(),
      ]);
      return {
        version: 1,
        exportedAt: now(),
        goals,
        steps,
        events,
        plans,
        logs,
        reviews,
      };
    },
    async importBackup(raw) {
      const payload = parseBackup(raw);
      await database.transaction(
        "rw",
        [
          database.goals,
          database.goalSteps,
          database.calendarEvents,
          database.planBlocks,
          database.completionLogs,
          database.dailyReviews,
        ],
        async () => {
          await Promise.all([
            database.goals.clear(),
            database.goalSteps.clear(),
            database.calendarEvents.clear(),
            database.planBlocks.clear(),
            database.completionLogs.clear(),
            database.dailyReviews.clear(),
          ]);
          await database.goals.bulkPut(payload.goals);
          await database.goalSteps.bulkPut(payload.steps);
          await database.calendarEvents.bulkPut(payload.events);
          await database.planBlocks.bulkPut(payload.plans);
          await database.completionLogs.bulkPut(payload.logs);
          await database.dailyReviews.bulkPut(payload.reviews);
        },
      );
    },
  };
  return service;
}

/** Default service used by screens; tests can create an isolated instance. */
export const taskService = createTaskService();
