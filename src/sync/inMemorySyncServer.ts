import { SyncTransportError } from "./errors";
import { validateSnapshot } from "./serializer";
import type {
  AuthSession,
  JsonObject,
  MutationReceipt,
  OutboxOp,
  PullPage,
  PushMutationResult,
  ServerBigInt,
  SyncObject,
  SyncTransport,
} from "./types";

type FailurePoint = "push-before-commit" | "push-after-commit" | "pull";

interface UserState {
  nextChangeSeq: bigint;
  objects: Map<string, SyncObject>;
  receipts: Map<string, MutationReceipt>;
  changes: SyncObject[];
}

export interface InMemorySyncServerOptions {
  readonly now?: () => Date;
}

function objectKey(operation: Pick<OutboxOp, "entityType" | "entityId">): string {
  return `${operation.entityType}\u0000${operation.entityId}`;
}

function cloneJson(snapshot: JsonObject | null): JsonObject | null {
  return snapshot === null ? null : JSON.parse(JSON.stringify(snapshot)) as JsonObject;
}

function cloneObject(object: SyncObject): SyncObject {
  return { ...object, snapshot: cloneJson(object.snapshot) };
}

/** Deterministic server double used to verify protocol behavior without credentials. */
export class InMemorySyncServer implements SyncTransport {
  private readonly users = new Map<string, UserState>();
  private readonly failures = new Map<FailurePoint, number>();
  private readonly now: () => Date;

  constructor(options: InMemorySyncServerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  injectFailure(point: FailurePoint, count = 1): void {
    this.failures.set(point, (this.failures.get(point) ?? 0) + count);
  }

  getObject(userId: string, entityType: OutboxOp["entityType"], entityId: string): SyncObject | undefined {
    const object = this.users.get(userId)?.objects.get(`${entityType}\u0000${entityId}`);
    return object ? cloneObject(object) : undefined;
  }

  getReceiptCount(userId: string): number {
    return this.users.get(userId)?.receipts.size ?? 0;
  }

  async pushMutation(session: AuthSession, operation: OutboxOp): Promise<PushMutationResult> {
    this.assertSession(session, operation.userId);
    this.failIfRequested("push-before-commit");
    const state = this.getUser(session.userId);

    const priorReceipt = state.receipts.get(operation.opId);
    if (priorReceipt) return { status: "applied", receipt: this.cloneReceipt(priorReceipt) };

    const key = objectKey(operation);
    const current = state.objects.get(key);
    const currentVersion = current?.serverVersion ?? null;
    if (currentVersion !== operation.baseServerVersion) {
      if (!current) {
        throw new SyncTransportError("server violated CAS invariant: missing conflict object", "server", false);
      }
      return { status: "conflict", remote: cloneObject(current) };
    }

    const isDeleted = operation.desiredSnapshot === null;
    const desired = isDeleted ? null : validateSnapshot(operation.entityType, operation.desiredSnapshot);
    if (desired !== null && desired.id !== operation.entityId) {
      throw new TypeError("snapshot id does not match operation entityId");
    }
    const version = (BigInt(currentVersion ?? "0") + 1n).toString();
    const changeSeq = state.nextChangeSeq.toString();
    state.nextChangeSeq += 1n;
    const changedAt = this.now().toISOString();
    const object: SyncObject = {
      userId: session.userId,
      entityType: operation.entityType,
      entityId: operation.entityId,
      serverVersion: version,
      changeSeq,
      snapshot: cloneJson(desired),
      isDeleted,
      changedAt,
    };
    const receipt: MutationReceipt = { opId: operation.opId, object };
    state.objects.set(key, object);
    state.receipts.set(operation.opId, receipt);
    state.changes.push(object);

    this.failIfRequested("push-after-commit");
    return { status: "applied", receipt: this.cloneReceipt(receipt) };
  }

  async pullChanges(session: AuthSession, afterChangeSeq: ServerBigInt, limit: number): Promise<PullPage> {
    this.assertSession(session, session.userId);
    this.failIfRequested("pull");
    if (!/^\d+$/.test(afterChangeSeq)) throw new TypeError("pull cursor must be a decimal string");
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("pull page size must be positive");
    const cursor = BigInt(afterChangeSeq);
    const state = this.getUser(session.userId);
    const remaining = state.changes.filter((change) => BigInt(change.changeSeq) > cursor);
    const changes = remaining.slice(0, limit).map(cloneObject);
    return {
      changes,
      nextCursor: changes.at(-1)?.changeSeq ?? afterChangeSeq,
      hasMore: remaining.length > changes.length,
    };
  }

  private getUser(userId: string): UserState {
    let state = this.users.get(userId);
    if (!state) {
      state = { nextChangeSeq: 1n, objects: new Map(), receipts: new Map(), changes: [] };
      this.users.set(userId, state);
    }
    return state;
  }

  private assertSession(session: AuthSession, expectedUserId: string): void {
    if (!session.accessToken || session.userId !== expectedUserId) {
      throw new SyncTransportError("unauthorized sync request", "unauthorized", false);
    }
  }

  private failIfRequested(point: FailurePoint): void {
    const remaining = this.failures.get(point) ?? 0;
    if (remaining < 1) return;
    this.failures.set(point, remaining - 1);
    throw new SyncTransportError(`injected ${point} failure`, "network", true);
  }

  private cloneReceipt(receipt: MutationReceipt): MutationReceipt {
    return { opId: receipt.opId, object: cloneObject(receipt.object) };
  }
}
