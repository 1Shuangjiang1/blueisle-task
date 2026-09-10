import { errorMessage, isRetryableError, isUnauthorizedError, SyncTransportError } from "./errors";
import { jsonValuesEqual, mergeSnapshots, parseSyncObject } from "./serializer";
import type {
  AuthGateway,
  AuthSession,
  LocalSyncStore,
  OutboxOp,
  PullPage,
  PushMutationResult,
  SyncConflict,
  SyncEngine,
  SyncRunResult,
  SyncShadow,
  SyncState,
  SyncTransport,
} from "./types";
import { createUuidV4 } from "../utils/uuid";

export interface SyncEngineOptions {
  readonly auth: AuthGateway;
  readonly transport: SyncTransport;
  readonly store: LocalSyncStore;
  readonly isOnline?: () => boolean;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createId?: () => string;
  readonly pullPageSize?: number;
  readonly maxPushAttempts?: number;
  readonly retryBaseMilliseconds?: number;
}

const INITIAL_STATE: SyncState = {
  phase: "idle",
  pendingCount: 0,
  lastSuccessAt: null,
  error: null,
};

function toShadow(object: ReturnType<typeof parseSyncObject>): SyncShadow {
  return { ...object };
}

function defaultId(): string {
  return createUuidV4();
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Push-first synchronization coordinator. Local persistence remains behind LocalSyncStore. */
export class DefaultSyncEngine implements SyncEngine {
  private readonly listeners = new Set<(state: SyncState) => void>();
  private readonly isOnline: () => boolean;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly createId: () => string;
  private readonly pullPageSize: number;
  private readonly maxPushAttempts: number;
  private readonly retryBaseMilliseconds: number;
  private state: SyncState = INITIAL_STATE;
  private activeRun: Promise<SyncRunResult> | null = null;

  constructor(private readonly options: SyncEngineOptions) {
    this.isOnline = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.createId = options.createId ?? defaultId;
    this.pullPageSize = options.pullPageSize ?? 100;
    this.maxPushAttempts = options.maxPushAttempts ?? 3;
    this.retryBaseMilliseconds = options.retryBaseMilliseconds ?? 250;
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncNow(): Promise<SyncRunResult> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.run().finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  private async run(): Promise<SyncRunResult> {
    if (!this.isOnline()) {
      this.setState({ ...this.state, phase: "offline", error: null });
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }

    let session = await this.options.auth.getSession();
    if (!session) {
      this.setState({ ...this.state, phase: "auth-required", error: null });
      return { pushed: 0, pulled: 0, conflicts: 0 };
    }

    this.setState({ ...this.state, phase: "syncing", error: null });
    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;

    try {
      // Reload after each acknowledgement because the store may atomically rebase a successor chain.
      for (;;) {
        const operations = await this.options.store.listPushableOutbox(session.userId, this.now().toISOString());
        this.setState({ ...this.state, pendingCount: operations.length });
        const operation = operations[0];
        if (!operation) break;

        const push = await this.pushWithRetry(session, operation);
        session = push.session;
        if (push.result.status === "applied") {
          if (push.result.receipt.opId !== operation.opId) {
            throw new SyncTransportError("server returned a receipt for another operation", "invalid-response", false);
          }
          const object = parseSyncObject(push.result.receipt.object);
          this.assertObjectOwner(session, object.userId);
          this.assertObjectIdentity(operation, object.entityType, object.entityId);
          await this.options.store.acknowledgeMutation(operation.opId, toShadow(object));
          pushed += 1;
          continue;
        }

        const remote = parseSyncObject(push.result.remote);
        this.assertObjectOwner(session, remote.userId);
        this.assertObjectIdentity(operation, remote.entityType, remote.entityId);
        const merge = mergeSnapshots(operation.baseSnapshot, operation.desiredSnapshot, remote.snapshot);
        if (merge.kind === "merged") {
          if (jsonValuesEqual(merge.snapshot, remote.snapshot)) {
            await this.options.store.acknowledgeMutation(operation.opId, toShadow(remote));
          } else {
            const replacement: OutboxOp = {
              ...operation,
              opId: this.createId(),
              baseServerVersion: remote.serverVersion,
              baseSnapshot: remote.snapshot,
              desiredSnapshot: merge.snapshot,
              predecessorOpId: null,
              createdAt: this.now().toISOString(),
              status: "queued",
              attemptCount: 0,
              nextAttemptAt: null,
              lastError: null,
            };
            await this.options.store.rebaseMutation(operation.opId, replacement, toShadow(remote));
          }
          continue;
        }

        const conflict: SyncConflict = {
          id: this.createId(),
          userId: session.userId,
          entityType: operation.entityType,
          entityId: operation.entityId,
          outboxOpId: operation.opId,
          baseSnapshot: operation.baseSnapshot,
          localSnapshot: operation.desiredSnapshot,
          remoteSnapshot: remote.snapshot,
          remoteServerVersion: remote.serverVersion,
          conflictFields: merge.fields,
          kind: merge.conflictKind,
          status: "unresolved",
          createdAt: this.now().toISOString(),
          resolutionOpId: null,
          resolvedAt: null,
        };
        await this.options.store.recordConflict(conflict, toShadow(remote));
        conflicts += 1;
      }

      let meta = await this.options.store.getSyncMeta(session.userId);
      for (;;) {
        const rawPage = await this.pullWithRefresh(session, meta.pullCursor);
        session = rawPage.session;
        const page = this.validatePage(session, meta.pullCursor, rawPage.page);
        await this.options.store.applyPullPage(session.userId, page, this.now().toISOString());
        pulled += page.changes.length;
        meta = { ...meta, pullCursor: page.nextCursor };
        if (!page.hasMore) break;
      }

      const completedAt = this.now().toISOString();
      await this.options.store.setSyncError(session.userId, null);
      this.setState({ phase: "idle", pendingCount: 0, lastSuccessAt: completedAt, error: null });
      return { pushed, pulled, conflicts };
    } catch (error) {
      const message = errorMessage(error);
      await this.options.store.setSyncError(session.userId, message);
      this.setState({
        ...this.state,
        phase: isUnauthorizedError(error) ? "auth-required" : "error",
        error: message,
      });
      throw error;
    }
  }

  private async pushWithRetry(
    initialSession: AuthSession,
    operation: OutboxOp,
  ): Promise<{ session: AuthSession; result: PushMutationResult }> {
    let session = initialSession;
    let refreshed = false;
    for (let attempt = 1; attempt <= this.maxPushAttempts; attempt += 1) {
      try {
        await this.options.store.markOutboxAttempt(operation.opId, operation.attemptCount + attempt, null, null);
        return { session, result: await this.options.transport.pushMutation(session, operation) };
      } catch (error) {
        if (isUnauthorizedError(error) && !refreshed) {
          const nextSession = await this.options.auth.refreshSession();
          if (!nextSession || nextSession.userId !== operation.userId) throw error;
          session = nextSession;
          refreshed = true;
          continue;
        }
        const retryable = isRetryableError(error);
        const finalAttempt = attempt === this.maxPushAttempts;
        const delay = this.retryBaseMilliseconds * 2 ** (attempt - 1);
        const nextAttemptAt = new Date(this.now().getTime() + delay).toISOString();
        await this.options.store.markOutboxAttempt(
          operation.opId,
          operation.attemptCount + attempt,
          retryable && !finalAttempt ? nextAttemptAt : null,
          errorMessage(error),
        );
        if (!retryable || finalAttempt) throw error;
        await this.sleep(delay);
      }
    }
    throw new SyncTransportError("push retry loop exhausted", "server", false);
  }

  private async pullWithRefresh(
    initialSession: AuthSession,
    cursor: string,
  ): Promise<{ session: AuthSession; page: PullPage }> {
    try {
      return {
        session: initialSession,
        page: await this.options.transport.pullChanges(initialSession, cursor, this.pullPageSize),
      };
    } catch (error) {
      if (!isUnauthorizedError(error)) throw error;
      const session = await this.options.auth.refreshSession();
      if (!session || session.userId !== initialSession.userId) throw error;
      return { session, page: await this.options.transport.pullChanges(session, cursor, this.pullPageSize) };
    }
  }

  private validatePage(session: AuthSession, cursor: string, raw: PullPage): PullPage {
    if (!/^\d+$/.test(raw.nextCursor) || BigInt(raw.nextCursor) < BigInt(cursor)) {
      throw new SyncTransportError("server returned a regressing pull cursor", "invalid-response", false);
    }
    const changes = raw.changes.map((change) => parseSyncObject(change));
    let previous = BigInt(cursor);
    for (const change of changes) {
      this.assertObjectOwner(session, change.userId);
      const sequence = BigInt(change.changeSeq);
      if (sequence <= previous || sequence > BigInt(raw.nextCursor)) {
        throw new SyncTransportError("server returned unordered changes outside the page cursor range", "invalid-response", false);
      }
      previous = sequence;
    }
    if (previous !== BigInt(raw.nextCursor)) {
      throw new SyncTransportError("server cursor does not match the final page change", "invalid-response", false);
    }
    if (raw.hasMore && changes.length === 0) {
      throw new SyncTransportError("server returned an empty non-final page", "invalid-response", false);
    }
    return { changes, nextCursor: raw.nextCursor, hasMore: raw.hasMore };
  }

  private assertObjectOwner(session: AuthSession, objectUserId: string): void {
    if (objectUserId !== session.userId) {
      throw new SyncTransportError("server returned another user's object", "invalid-response", false);
    }
  }

  private assertObjectIdentity(operation: OutboxOp, entityType: string, entityId: string): void {
    if (entityType !== operation.entityType || entityId !== operation.entityId) {
      throw new SyncTransportError("server returned an object for another mutation target", "invalid-response", false);
    }
  }

  private setState(state: SyncState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
