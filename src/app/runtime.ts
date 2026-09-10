import { createSupabaseRuntime, type AccountState } from "../auth";
import { createAccountDatabase, db, type TaskDatabase } from "../data/db";
import { createLocalSyncStore } from "../data/local-sync-store";
import { createTaskService, type TaskService } from "../data/service";
import { DefaultSyncEngine } from "../sync/syncEngine";
import { SupabaseSyncTransport } from "../sync/supabaseTransport";
import type { EntityType, OutboxOp, SyncConflict, SyncEngine, SyncShadow } from "../sync/types";
import type { BaseEntity } from "../domain/models";
import { mergeSnapshots } from "../sync/serializer";

export interface AppWorkspace {
  readonly accountId: string | null;
  readonly database: TaskDatabase;
  readonly service: TaskService;
  readonly syncEngine: SyncEngine | null;
}

const supabase = createSupabaseRuntime();

/** UUID v4 IDs are required by the sync RPC even on older WebViews. */
export function createRuntimeId(
  cryptoSource: Pick<Crypto, "randomUUID" | "getRandomValues"> | null = globalThis.crypto ?? null,
): string {
  if (cryptoSource?.randomUUID) return cryptoSource.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoSource?.getRandomValues) {
    cryptoSource.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function entityTable(database: TaskDatabase, entityType: EntityType) {
  return database[entityType] as unknown as {
    get(id: string): Promise<BaseEntity | undefined>;
    put(value: BaseEntity): Promise<unknown>;
  };
}

function shadowId(conflict: SyncConflict): string {
  return `${conflict.userId}\u0000${conflict.entityType}\u0000${conflict.entityId}`;
}

function operationDescendants(chain: readonly OutboxOp[], rootId: string): OutboxOp[] {
  const descendants: OutboxOp[] = [];
  let predecessorId = rootId;
  while (true) {
    const successors = chain.filter((operation) => operation.predecessorOpId === predecessorId);
    if (successors.length > 1) throw new Error("同步操作链出现分叉，请先导出备份并重试");
    const successor = successors[0];
    if (!successor) return descendants;
    descendants.push(successor);
    predecessorId = successor.opId;
  }
}

async function applySnapshot(
  table: ReturnType<typeof entityTable>,
  entityId: string,
  snapshot: OutboxOp["desiredSnapshot"],
  deletedAt: string,
): Promise<void> {
  if (snapshot) {
    await table.put(snapshot as unknown as BaseEntity);
    return;
  }
  const local = await table.get(entityId);
  if (local) {
    await table.put({
      ...local,
      updatedAt: deletedAt,
      deletedAt,
      entityVersion: local.entityVersion + 1,
    });
  }
}

function makeResolutionOperation(
  conflict: SyncConflict,
  desiredSnapshot: OutboxOp["desiredSnapshot"],
  status: OutboxOp["status"] = "queued",
): OutboxOp {
  return {
    opId: createRuntimeId(),
    userId: conflict.userId,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    baseServerVersion: conflict.remoteServerVersion,
    baseSnapshot: conflict.remoteSnapshot,
    desiredSnapshot,
    predecessorOpId: null,
    createdAt: new Date().toISOString(),
    status,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
  };
}

/** Creates a data boundary for either the legacy guest data or one signed-in account. */
export async function openWorkspace(userId: string | null): Promise<AppWorkspace> {
  const database = userId ? createAccountDatabase(userId, { seedOnReady: false }) : db;
  await database.open();
  const service = createTaskService(database);
  const syncEngine = userId && supabase.client
    ? new DefaultSyncEngine({
        auth: supabase.auth,
        transport: new SupabaseSyncTransport(supabase.client),
        store: createLocalSyncStore(database),
      })
    : null;
  return { accountId: userId, database, service, syncEngine };
}

/** Resolve an explicit conflict by keeping the current device record or the server record. */
export async function resolveWorkspaceConflict(
  workspace: AppWorkspace,
  conflict: SyncConflict,
  choice: "local" | "remote",
): Promise<void> {
  if (!workspace.accountId || workspace.accountId !== conflict.userId) {
    throw new Error("当前账号与该同步差异不匹配");
  }
  const { database } = workspace;
  const table = entityTable(database, conflict.entityType);
  await database.transaction(
    "rw",
    database.syncOutbox,
    database.syncShadows,
    database.syncConflicts,
    table as never,
    async () => {
      const current = await database.syncConflicts.get(conflict.id);
      if (!current || current.status === "resolved") return;
      const chain = await database.syncOutbox
        .where("[userId+entityType+entityId]")
        .equals([conflict.userId, conflict.entityType, conflict.entityId])
        .toArray();
      const original = chain.find((operation) => operation.opId === current.outboxOpId);
      if (!original) throw new Error("找不到产生该同步差异的本机操作，请先导出备份");
      const descendants = operationDescendants(chain, original.opId);
      // recordConflict blocks everything that already existed. Operations still
      // queued/sending are edits made after the conflict was shown to the user.
      const postConflictEdits = descendants.filter((operation) => operation.status !== "blocked");
      const latestPostConflictEdit = postConflictEdits.at(-1);
      await Promise.all(chain.map((operation) => database.syncOutbox.delete(operation.opId)));

      // recordConflict has already persisted the full untrusted server object
      // transactionally. Keep its cursor and server timestamp for the next pull.
      const existingShadow = await database.syncShadows.get(shadowId(conflict));
      const remoteShadow: SyncShadow = existingShadow ?? {
        userId: conflict.userId,
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        serverVersion: conflict.remoteServerVersion,
        // Defensive fallback for legacy conflicts created before shadow storage.
        changeSeq: "0",
        snapshot: conflict.remoteSnapshot,
        isDeleted: conflict.remoteSnapshot === null,
        changedAt: new Date().toISOString(),
      };
      if (!existingShadow) await database.syncShadows.put({ ...remoteShadow, id: shadowId(conflict) });

      let resolutionOpId: string | null = null;
      if (choice === "remote") {
        if (!latestPostConflictEdit) {
          await applySnapshot(table, conflict.entityId, conflict.remoteSnapshot, remoteShadow.changedAt);
        } else {
          const merge = mergeSnapshots(
            current.localSnapshot,
            latestPostConflictEdit.desiredSnapshot,
            current.remoteSnapshot,
          );
          if (merge.kind === "merged") {
            await applySnapshot(table, conflict.entityId, merge.snapshot, remoteShadow.changedAt);
            const recovery = makeResolutionOperation(current, merge.snapshot);
            resolutionOpId = recovery.opId;
            await database.syncOutbox.add(recovery);
          } else {
            // The user chose the remote version of the original conflict, but a
            // later local edit touched the same field. Keep that edit visible
            // and ask explicitly instead of silently discarding it.
            const recovery = makeResolutionOperation(
              current,
              latestPostConflictEdit.desiredSnapshot,
              "blocked",
            );
            resolutionOpId = recovery.opId;
            await database.syncOutbox.add(recovery);
            await database.syncConflicts.add({
              ...current,
              id: createRuntimeId(),
              outboxOpId: recovery.opId,
              baseSnapshot: current.localSnapshot,
              localSnapshot: latestPostConflictEdit.desiredSnapshot,
              conflictFields: merge.fields,
              kind: merge.conflictKind,
              status: "unresolved",
              createdAt: new Date().toISOString(),
              resolutionOpId: null,
              resolvedAt: null,
            });
          }
        }
      } else {
        const local = await table.get(conflict.entityId);
        const desiredSnapshot = local && !local.deletedAt
          ? JSON.parse(JSON.stringify(local)) as OutboxOp["desiredSnapshot"]
          : null;
        const operation = makeResolutionOperation(current, desiredSnapshot);
        resolutionOpId = operation.opId;
        await database.syncOutbox.add(operation);
      }
      await database.syncConflicts.put({
        ...current,
        status: "resolved",
        resolutionOpId,
        resolvedAt: new Date().toISOString(),
      });
    },
  );
}

export const appAuth = supabase.auth;
export const initialAccountState = (): AccountState => supabase.auth.getState();
