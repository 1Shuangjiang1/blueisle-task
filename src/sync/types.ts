/** JSON values that are safe to persist locally and send through the sync API. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

/** PostgreSQL bigint values cross the JavaScript boundary as decimal strings. */
export type ServerBigInt = string;
export type EntityType =
  | "goals"
  | "goalSteps"
  | "calendarEvents"
  | "planBlocks"
  | "completionLogs"
  | "dailyReviews";

export interface AuthSession {
  readonly userId: string;
  readonly accessToken: string;
}

export interface AuthGateway {
  getSession(): Promise<AuthSession | null>;
  refreshSession(): Promise<AuthSession | null>;
}

export type OutboxStatus = "queued" | "sending" | "blocked";

/** Immutable mutation payload plus mutable delivery bookkeeping. */
export interface OutboxOp {
  readonly opId: string;
  readonly userId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly baseServerVersion: ServerBigInt | null;
  readonly baseSnapshot: JsonObject | null;
  readonly desiredSnapshot: JsonObject | null;
  readonly predecessorOpId: string | null;
  readonly createdAt: string;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
}

export interface SyncObject {
  readonly userId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly serverVersion: ServerBigInt;
  readonly changeSeq: ServerBigInt;
  readonly snapshot: JsonObject | null;
  readonly isDeleted: boolean;
  readonly changedAt: string;
}

export interface SyncShadow {
  readonly userId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly serverVersion: ServerBigInt;
  readonly changeSeq: ServerBigInt;
  readonly snapshot: JsonObject | null;
  readonly isDeleted: boolean;
  readonly changedAt: string;
}

export type ConflictKind = "field" | "delete-edit";
export type ConflictStatus = "unresolved" | "resolving" | "resolved";

export interface SyncConflict {
  readonly id: string;
  readonly userId: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly outboxOpId: string;
  readonly baseSnapshot: JsonObject | null;
  readonly localSnapshot: JsonObject | null;
  readonly remoteSnapshot: JsonObject | null;
  readonly remoteServerVersion: ServerBigInt;
  readonly conflictFields: readonly string[];
  readonly kind: ConflictKind;
  readonly status: ConflictStatus;
  readonly createdAt: string;
  readonly resolutionOpId: string | null;
  readonly resolvedAt: string | null;
}

export interface SyncMeta {
  readonly userId: string;
  readonly pullCursor: ServerBigInt;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
}

export interface MutationReceipt {
  readonly opId: string;
  readonly object: SyncObject;
}

export type PushMutationResult =
  | { readonly status: "applied"; readonly receipt: MutationReceipt }
  | { readonly status: "conflict"; readonly remote: SyncObject };

export interface PullPage {
  readonly changes: readonly SyncObject[];
  readonly nextCursor: ServerBigInt;
  readonly hasMore: boolean;
}

export interface SyncTransport {
  pushMutation(session: AuthSession, operation: OutboxOp): Promise<PushMutationResult>;
  pullChanges(
    session: AuthSession,
    afterChangeSeq: ServerBigInt,
    limit: number,
  ): Promise<PullPage>;
}

export interface LocalSyncStore {
  listPushableOutbox(userId: string, now: string): Promise<readonly OutboxOp[]>;
  markOutboxAttempt(opId: string, attemptCount: number, nextAttemptAt: string | null, error: string | null): Promise<void>;
  acknowledgeMutation(opId: string, shadow: SyncShadow): Promise<void>;
  /** Atomically supersede an operation after a clean three-way merge. */
  rebaseMutation(
    oldOpId: string,
    replacement: OutboxOp,
    remoteShadow: SyncShadow,
  ): Promise<void>;
  /** Atomically save the conflict and block this entity's pending operation chain. */
  recordConflict(conflict: SyncConflict, remoteShadow: SyncShadow): Promise<void>;
  getSyncMeta(userId: string): Promise<SyncMeta>;
  /** Apply entity changes, shadows, and the cursor in one local transaction. */
  applyPullPage(userId: string, page: PullPage, completedAt: string): Promise<void>;
  setSyncError(userId: string, error: string | null): Promise<void>;
}

export type SyncPhase = "idle" | "syncing" | "offline" | "auth-required" | "error";

export interface SyncState {
  readonly phase: SyncPhase;
  readonly pendingCount: number;
  readonly lastSuccessAt: string | null;
  readonly error: string | null;
}

export interface SyncRunResult {
  readonly pushed: number;
  readonly pulled: number;
  readonly conflicts: number;
}

export interface SyncEngine {
  getState(): SyncState;
  subscribe(listener: (state: SyncState) => void): () => void;
  syncNow(): Promise<SyncRunResult>;
}

