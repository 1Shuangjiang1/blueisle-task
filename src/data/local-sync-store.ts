import type { Table } from "dexie";
import type { BaseEntity, SyncOutboxOperation } from "../domain/models";
import type {
  EntityType,
  LocalSyncStore,
  OutboxOp,
  PullPage,
  SyncConflict,
  SyncMeta,
  SyncObject,
  SyncShadow,
} from "../sync/types";
import type { TaskDatabase } from "./db";
import { createUuidV4 } from "../utils/uuid";

const ZERO_CURSOR = "0";
const makeId = createUuidV4;

const shadowId = (userId: string, entityType: EntityType, entityId: string) =>
  `${userId}\u0000${entityType}\u0000${entityId}`;

const asOutbox = (operation: SyncOutboxOperation): OutboxOp => operation;

function asShadowRecord(shadow: SyncShadow) {
  return { ...shadow, id: shadowId(shadow.userId, shadow.entityType, shadow.entityId) };
}

function shadowFromObject(object: SyncObject): SyncShadow {
  return {
    userId: object.userId,
    entityType: object.entityType,
    entityId: object.entityId,
    serverVersion: object.serverVersion,
    changeSeq: object.changeSeq,
    snapshot: object.snapshot,
    isDeleted: object.isDeleted,
    changedAt: object.changedAt,
  };
}

/** Return a validated linear successor list beginning after `predecessorOpId`. */
function successorsAfter(
  operations: readonly SyncOutboxOperation[],
  predecessorOpId: string,
): SyncOutboxOperation[] {
  const byId = new Map(operations.map((operation) => [operation.opId, operation]));
  if (byId.size !== operations.length) throw new Error("同步队列异常：存在重复操作 ID");
  const successorsByPredecessor = new Map<string, SyncOutboxOperation[]>();
  for (const operation of operations) {
    if (!operation.predecessorOpId) continue;
    if (!byId.has(operation.predecessorOpId)) {
      throw new Error("同步队列异常：操作前置记录缺失");
    }
    const successors = successorsByPredecessor.get(operation.predecessorOpId) ?? [];
    successors.push(operation);
    successorsByPredecessor.set(operation.predecessorOpId, successors);
  }
  for (const successors of successorsByPredecessor.values()) {
    if (successors.length > 1) throw new Error("同步队列异常：操作链出现分叉");
  }

  const result: SyncOutboxOperation[] = [];
  const seen = new Set<string>([predecessorOpId]);
  let cursor = predecessorOpId;
  while (true) {
    const successor = successorsByPredecessor.get(cursor)?.[0];
    if (!successor) return result;
    if (seen.has(successor.opId)) throw new Error("同步队列异常：操作链出现环");
    seen.add(successor.opId);
    result.push(successor);
    cursor = successor.opId;
  }
}

function assertValidOutboxGraph(operations: readonly SyncOutboxOperation[]): void {
  if (operations.length === 0) return;
  const roots = operations.filter((operation) => !operation.predecessorOpId);
  if (roots.length !== 1) throw new Error("同步队列异常：操作链必须只有一个起点");
  const chain = successorsAfter(operations, roots[0]!.opId);
  if (chain.length + 1 !== operations.length) {
    throw new Error("同步队列异常：操作链不连通");
  }
}

function assertValidOutboxGraphs(operations: readonly SyncOutboxOperation[]): void {
  const groups = new Map<string, SyncOutboxOperation[]>();
  for (const operation of operations) {
    const key = `${operation.entityType}\u0000${operation.entityId}`;
    const group = groups.get(key) ?? [];
    group.push(operation);
    groups.set(key, group);
  }
  for (const group of groups.values()) assertValidOutboxGraph(group);
}

/**
 * Dexie implementation of the sync engine boundary. Its methods are the only
 * place where delivery bookkeeping, shadows and pulled business records mix.
 */
export class DexieLocalSyncStore implements LocalSyncStore {
  constructor(private readonly database: TaskDatabase) {}

  private entityTable(entityType: EntityType): Table<BaseEntity, string> {
    return this.database[entityType] as unknown as Table<BaseEntity, string>;
  }

  async listPushableOutbox(userId: string, currentTime: string): Promise<readonly OutboxOp[]> {
    // "sending" survives a crash between request dispatch and receipt storage.
    // A fresh sync mutex may safely retry it with the same opId.
    const all = await this.database.syncOutbox.where("userId").equals(userId).toArray();
    const candidates = all.filter(
      (operation) => operation.status === "queued" || operation.status === "sending",
    );
    assertValidOutboxGraphs(all);
    const ids = new Set(all.map((operation) => operation.opId));
    return candidates
      .filter((operation) =>
        (!operation.nextAttemptAt || operation.nextAttemptAt <= currentTime) &&
        // A predecessor outside the candidate set may still be sending or blocked.
        (!operation.predecessorOpId || !ids.has(operation.predecessorOpId)),
      )
      .sort((left, right) => left.opId.localeCompare(right.opId))
      .map(asOutbox);
  }

  async markOutboxAttempt(
    opId: string,
    attemptCount: number,
    nextAttemptAt: string | null,
    error: string | null,
  ): Promise<void> {
    const operation = await this.database.syncOutbox.get(opId);
    if (!operation) return;
    await this.database.syncOutbox.put({
      ...operation,
      status: error ? "queued" : "sending",
      attemptCount,
      nextAttemptAt,
      lastError: error,
    });
  }

  async acknowledgeMutation(opId: string, shadow: SyncShadow): Promise<void> {
    await this.database.transaction("rw", this.database.syncOutbox, this.database.syncShadows, async () => {
      const current = await this.database.syncOutbox.get(opId);
      if (!current) return;
      const operations = await this.database.syncOutbox
        .where("[userId+entityType+entityId]")
        .equals([current.userId, current.entityType, current.entityId])
        .toArray();
      assertValidOutboxGraph(operations);
      const successors = successorsAfter(operations, opId);
      await this.database.syncOutbox.delete(opId);
      await Promise.all(successors.map((operation) => this.database.syncOutbox.delete(operation.opId)));
      await this.database.syncShadows.put(asShadowRecord(shadow));
      let replacementPredecessor: string | null = null;
      for (let index = 0; index < successors.length; index += 1) {
        const original = successors[index]!;
        const replacement: SyncOutboxOperation = {
          ...original,
          opId: makeId(),
          // The immediate successor is rebased against the receipt. Later
          // entries keep their immutable desired snapshots but point at the
          // fresh chain and will be rebased when their predecessor is acked.
          baseServerVersion: index === 0 ? shadow.serverVersion : original.baseServerVersion,
          baseSnapshot: index === 0 ? shadow.snapshot : original.baseSnapshot,
          predecessorOpId: replacementPredecessor,
          status: original.status === "sending" ? "queued" : original.status,
        };
        await this.database.syncOutbox.add(replacement);
        replacementPredecessor = replacement.opId;
      }
    });
  }

  async rebaseMutation(oldOpId: string, replacement: OutboxOp, remoteShadow: SyncShadow): Promise<void> {
    await this.database.transaction("rw", this.database.syncOutbox, this.database.syncShadows, async () => {
      const current = await this.database.syncOutbox.get(oldOpId);
      const successors = current ? await this.findSuccessors(current) : [];
      await this.database.syncOutbox.delete(oldOpId);
      await Promise.all(successors.map((operation) => this.database.syncOutbox.delete(operation.opId)));
      await this.database.syncOutbox.add({ ...replacement });
      let predecessorOpId: string | null = replacement.opId;
      for (const original of successors) {
        const rebuilt: SyncOutboxOperation = {
          ...original,
          opId: makeId(),
          predecessorOpId,
          status: original.status === "sending" ? "queued" : original.status,
        };
        await this.database.syncOutbox.add(rebuilt);
        predecessorOpId = rebuilt.opId;
      }
      await this.database.syncShadows.put(asShadowRecord(remoteShadow));
    });
  }

  async recordConflict(conflict: SyncConflict, remoteShadow: SyncShadow): Promise<void> {
    await this.database.transaction(
      "rw",
      this.database.syncOutbox,
      this.database.syncShadows,
      this.database.syncConflicts,
      async () => {
        const chain = await this.database.syncOutbox
          .where("[userId+entityType+entityId]")
          .equals([conflict.userId, conflict.entityType, conflict.entityId])
          .toArray();
        await Promise.all(chain.map((operation) => this.database.syncOutbox.put({ ...operation, status: "blocked" })));
        await this.database.syncConflicts.put(conflict);
        await this.database.syncShadows.put(asShadowRecord(remoteShadow));
      },
    );
  }

  async getSyncMeta(userId: string): Promise<SyncMeta> {
    const meta = await this.database.syncMeta.get(userId);
    return meta ?? { userId, pullCursor: ZERO_CURSOR, lastSuccessAt: null, lastError: null };
  }

  async applyPullPage(userId: string, page: PullPage, completedAt: string): Promise<void> {
    const tables = [
      this.database.goals,
      this.database.goalSteps,
      this.database.calendarEvents,
      this.database.planBlocks,
      this.database.completionLogs,
      this.database.dailyReviews,
      this.database.syncOutbox,
      this.database.syncShadows,
      this.database.syncMeta,
    ];
    await this.database.transaction("rw", tables, async () => {
      for (const object of page.changes) {
        if (object.userId !== userId) continue;
        const hasLocalChain = await this.database.syncOutbox
          .where("[userId+entityType+entityId]")
          .equals([userId, object.entityType, object.entityId])
          .count() > 0;
        if (!hasLocalChain) await this.applyRemoteObject(object);
        await this.database.syncShadows.put(asShadowRecord(shadowFromObject(object)));
      }
      await this.database.syncMeta.put({
        userId,
        pullCursor: page.nextCursor,
        lastSuccessAt: completedAt,
        lastError: null,
      });
    });
  }

  private async applyRemoteObject(object: SyncObject): Promise<void> {
    const table = this.entityTable(object.entityType);
    if (!object.isDeleted && object.snapshot) {
      await table.put(object.snapshot as unknown as BaseEntity);
      return;
    }
    const current = await table.get(object.entityId);
    if (current) {
      await table.put({
        ...current,
        deletedAt: object.changedAt,
        updatedAt: object.changedAt,
        entityVersion: current.entityVersion + 1,
      });
    }
  }

  async setSyncError(userId: string, error: string | null): Promise<void> {
    const meta = await this.getSyncMeta(userId);
    await this.database.syncMeta.put({ ...meta, lastError: error });
  }

  private async findSuccessors(current: SyncOutboxOperation): Promise<SyncOutboxOperation[]> {
    const operations = await this.database.syncOutbox
      .where("[userId+entityType+entityId]")
      .equals([current.userId, current.entityType, current.entityId])
      .toArray();
    assertValidOutboxGraph(operations);
    return successorsAfter(operations, current.opId);
  }
}

export const createLocalSyncStore = (database: TaskDatabase) =>
  new DexieLocalSyncStore(database);
