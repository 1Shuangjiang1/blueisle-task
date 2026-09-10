import { describe, expect, it } from "vitest";
import { InMemorySyncServer } from "./inMemorySyncServer";
import { mergeSnapshots } from "./serializer";
import { DefaultSyncEngine } from "./syncEngine";
import type {
  AuthGateway,
  AuthSession,
  JsonObject,
  LocalSyncStore,
  OutboxOp,
  PullPage,
  SyncConflict,
  SyncMeta,
  SyncShadow,
} from "./types";

const session: AuthSession = { userId: "user-a", accessToken: "token-a" };
const auth: AuthGateway = {
  async getSession() { return session; },
  async refreshSession() { return session; },
};

function goal(id: string, title: string, description?: string, updatedAt = "2026-01-01T00:00:00.000Z"): JsonObject {
  return {
    id,
    title,
    ...(description === undefined ? {} : { description }),
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    entityVersion: 1,
  };
}

function operation(overrides: Partial<OutboxOp> = {}): OutboxOp {
  return {
    opId: "00000000-0000-4000-8000-000000000001",
    userId: "user-a",
    entityType: "goals",
    entityId: "goal-1",
    baseServerVersion: null,
    baseSnapshot: null,
    desiredSnapshot: goal("goal-1", "Initial"),
    predecessorOpId: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    ...overrides,
  };
}

class TestStore implements LocalSyncStore {
  operations: OutboxOp[];
  shadows: SyncShadow[] = [];
  conflicts: SyncConflict[] = [];
  pages: PullPage[] = [];
  meta: SyncMeta = { userId: "user-a", pullCursor: "0", lastSuccessAt: null, lastError: null };

  constructor(operations: OutboxOp[] = []) { this.operations = operations; }

  async listPushableOutbox(userId: string): Promise<readonly OutboxOp[]> {
    return this.operations.filter((item) => item.userId === userId && item.status === "queued" && !item.predecessorOpId);
  }
  async markOutboxAttempt(): Promise<void> {}
  async acknowledgeMutation(opId: string, shadow: SyncShadow): Promise<void> {
    this.operations = this.operations.filter((item) => item.opId !== opId);
    this.shadows.push(shadow);
  }
  async rebaseMutation(oldOpId: string, replacement: OutboxOp, remoteShadow: SyncShadow): Promise<void> {
    this.operations = this.operations.filter((item) => item.opId !== oldOpId).concat(replacement);
    this.shadows.push(remoteShadow);
  }
  async recordConflict(conflict: SyncConflict, remoteShadow: SyncShadow): Promise<void> {
    this.conflicts.push(conflict);
    this.shadows.push(remoteShadow);
    this.operations = this.operations.map((item) => item.entityId === conflict.entityId ? { ...item, status: "blocked" } : item);
  }
  async getSyncMeta(): Promise<SyncMeta> { return this.meta; }
  async applyPullPage(_userId: string, page: PullPage, completedAt: string): Promise<void> {
    this.pages.push(page);
    this.meta = { userId: "user-a", pullCursor: page.nextCursor, lastSuccessAt: completedAt, lastError: null };
  }
  async setSyncError(_userId: string, error: string | null): Promise<void> { this.meta = { ...this.meta, lastError: error }; }
}

describe("InMemorySyncServer", () => {
  it("returns the original receipt when the commit response is lost and the same opId is retried", async () => {
    const server = new InMemorySyncServer({ now: () => new Date("2026-02-01T00:00:00.000Z") });
    const op = operation();
    server.injectFailure("push-after-commit");
    await expect(server.pushMutation(session, op)).rejects.toThrow("injected");
    const retried = await server.pushMutation(session, op);

    expect(retried.status).toBe("applied");
    if (retried.status === "applied") {
      expect(retried.receipt.object.serverVersion).toBe("1");
      expect(retried.receipt.object.changeSeq).toBe("1");
      expect(retried.receipt.object.changedAt).toBe("2026-02-01T00:00:00.000Z");
    }
    expect(server.getReceiptCount("user-a")).toBe(1);
  });

  it("isolates users and keeps tombstones in the change stream", async () => {
    const server = new InMemorySyncServer();
    const first = operation();
    await server.pushMutation(session, first);
    await server.pushMutation(session, operation({
      opId: "00000000-0000-4000-8000-000000000002",
      baseServerVersion: "1",
      baseSnapshot: first.desiredSnapshot,
      desiredSnapshot: null,
    }));
    const otherSession = { userId: "user-b", accessToken: "token-b" };

    expect((await server.pullChanges(otherSession, "0", 10)).changes).toHaveLength(0);
    const own = await server.pullChanges(session, "0", 10);
    expect(own.changes).toHaveLength(2);
    expect(own.changes[1]?.isDeleted).toBe(true);
  });
});

describe("three-way serializer merge", () => {
  it("merges different top-level fields despite divergent device timestamps", () => {
    const base = goal("goal-1", "Base", "old");
    const local = { ...base, description: "local notes", updatedAt: "2040-01-01T00:00:00.000Z", entityVersion: 2 };
    const remote = { ...base, title: "Remote title", updatedAt: "2020-01-01T00:00:00.000Z", entityVersion: 2 };
    const result = mergeSnapshots(base, local, remote);
    expect(result.kind).toBe("merged");
    if (result.kind === "merged") {
      expect(result.snapshot).toMatchObject({ title: "Remote title", description: "local notes" });
    }
  });

  it("surfaces a divergent edit of the same text field", () => {
    const base = goal("goal-1", "Base");
    const result = mergeSnapshots(base, { ...base, title: "Local" }, { ...base, title: "Remote" });
    expect(result).toEqual({ kind: "conflict", fields: ["title"], conflictKind: "field" });
  });
});

describe("DefaultSyncEngine", () => {
  it("retries a lost response with the same operation and acknowledges it once", async () => {
    const server = new InMemorySyncServer();
    server.injectFailure("push-after-commit");
    const store = new TestStore([operation()]);
    const engine = new DefaultSyncEngine({ auth, transport: server, store, sleep: async () => {}, retryBaseMilliseconds: 1 });
    const result = await engine.syncNow();
    expect(result.pushed).toBe(1);
    expect(store.operations).toHaveLength(0);
    expect(server.getReceiptCount("user-a")).toBe(1);
  });

  it("records a stale same-field edit as a conflict and does not retry it", async () => {
    const server = new InMemorySyncServer();
    const base = goal("goal-1", "Base");
    await server.pushMutation(session, operation({ desiredSnapshot: base }));
    await server.pushMutation(session, operation({
      opId: "00000000-0000-4000-8000-000000000002",
      baseServerVersion: "1",
      baseSnapshot: base,
      desiredSnapshot: { ...base, title: "Remote" },
    }));
    const store = new TestStore([operation({
      opId: "00000000-0000-4000-8000-000000000003",
      baseServerVersion: "1",
      baseSnapshot: base,
      desiredSnapshot: { ...base, title: "Local" },
    })]);
    const engine = new DefaultSyncEngine({ auth, transport: server, store });
    const result = await engine.syncNow();
    expect(result.conflicts).toBe(1);
    expect(store.conflicts[0]?.conflictFields).toEqual(["title"]);
    expect(store.operations[0]?.status).toBe("blocked");
  });

  it("rebases and pushes a stale edit when only different fields changed", async () => {
    const server = new InMemorySyncServer();
    const base = goal("goal-1", "Base", "base notes");
    await server.pushMutation(session, operation({ desiredSnapshot: base }));
    await server.pushMutation(session, operation({
      opId: "00000000-0000-4000-8000-000000000002",
      baseServerVersion: "1",
      baseSnapshot: base,
      desiredSnapshot: { ...base, title: "Remote title", updatedAt: "2026-01-02T00:00:00.000Z", entityVersion: 2 },
    }));
    const store = new TestStore([operation({
      opId: "00000000-0000-4000-8000-000000000003",
      baseServerVersion: "1",
      baseSnapshot: base,
      desiredSnapshot: { ...base, description: "local notes", updatedAt: "2099-01-01T00:00:00.000Z", entityVersion: 2 },
    })]);
    let generated = 10;
    const engine = new DefaultSyncEngine({
      auth,
      transport: server,
      store,
      createId: () => `00000000-0000-4000-8000-0000000000${generated++}`,
    });
    const result = await engine.syncNow();
    expect(result).toMatchObject({ pushed: 1, conflicts: 0 });
    expect(server.getObject("user-a", "goals", "goal-1")?.snapshot).toMatchObject({
      title: "Remote title",
      description: "local notes",
    });
  });

  it("pulls every page in server sequence order; the device clock does not order writes", async () => {
    let serverTime = 0;
    const server = new InMemorySyncServer({
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, serverTime++)),
    });
    for (let index = 0; index < 3; index += 1) {
      await server.pushMutation(session, operation({
        opId: `00000000-0000-4000-8000-00000000000${index + 1}`,
        entityId: `goal-${index}`,
        desiredSnapshot: goal(`goal-${index}`, `Goal ${index}`),
        createdAt: index === 0 ? "2200-01-01T00:00:00.000Z" : "1900-01-01T00:00:00.000Z",
      }));
    }
    const store = new TestStore();
    const engine = new DefaultSyncEngine({
      auth,
      transport: server,
      store,
      pullPageSize: 2,
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });
    await engine.syncNow();
    expect(store.pages.map((page) => page.nextCursor)).toEqual(["2", "3"]);
    expect(store.pages.flatMap((page) => page.changes.map((item) => item.changeSeq))).toEqual(["1", "2", "3"]);
    expect(store.pages[0]?.changes[0]?.changedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not advance the cursor when fetching a page fails", async () => {
    const server = new InMemorySyncServer();
    await server.pushMutation(session, operation());
    server.injectFailure("pull");
    const store = new TestStore();
    const engine = new DefaultSyncEngine({ auth, transport: server, store });
    await expect(engine.syncNow()).rejects.toThrow("injected pull failure");
    expect(store.meta.pullCursor).toBe("0");
    expect(store.pages).toHaveLength(0);
  });
});
