import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TaskDatabase } from "./db";
import { createLocalSyncStore } from "./local-sync-store";
import { createTaskService } from "./service";

const databases: TaskDatabase[] = [];

async function setup() {
  const database = new TaskDatabase(`sync-store-${crypto.randomUUID()}`, false, "user-a");
  databases.push(database);
  await database.open();
  return { database, service: createTaskService(database), store: createLocalSyncStore(database) };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe("DexieLocalSyncStore", () => {
  it("only exposes the head of a predecessor chain and advances after acknowledgement", async () => {
    const { database, service, store } = await setup();
    const goal = await service.createGoal({ title: "第一版" });
    await service.goals.update(goal.id, { title: "第二版" });
    const [first] = await store.listPushableOutbox("user-a", "9999-01-01T00:00:00.000Z");
    expect(first?.desiredSnapshot).toMatchObject({ title: "第一版" });
    await store.acknowledgeMutation(first!.opId, {
      userId: "user-a", entityType: "goals", entityId: goal.id,
      serverVersion: "1", changeSeq: "1", snapshot: first!.desiredSnapshot,
      isDeleted: false, changedAt: "2026-09-10T00:00:00.000Z",
    });
    const next = await store.listPushableOutbox("user-a", "9999-01-01T00:00:00.000Z");
    expect(next).toHaveLength(1);
    expect(next[0]?.desiredSnapshot).toMatchObject({ title: "第二版" });
    expect(next[0]?.baseServerVersion).toBe("1");
    expect(next[0]?.predecessorOpId).toBeNull();
    expect(await database.syncShadows.count()).toBe(1);
  });

  it("applies a pull page with its shadow and cursor atomically", async () => {
    const { database, store } = await setup();
    await store.applyPullPage("user-a", {
      changes: [{
        userId: "user-a", entityType: "goals", entityId: "remote-goal",
        serverVersion: "7", changeSeq: "11", isDeleted: false,
        changedAt: "2026-09-10T00:00:00.000Z",
        snapshot: {
          id: "remote-goal", title: "云端目标", status: "active", createdAt: "2026-09-10T00:00:00.000Z",
          updatedAt: "2026-09-10T00:00:00.000Z", entityVersion: 1,
        },
      }],
      nextCursor: "11", hasMore: false,
    }, "2026-09-10T00:01:00.000Z");
    expect((await database.goals.get("remote-goal"))?.title).toBe("云端目标");
    expect((await store.getSyncMeta("user-a")).pullCursor).toBe("11");
    expect((await database.syncShadows.toArray())[0]?.serverVersion).toBe("7");
  });

  it("retries an interrupted sending operation with its original op id", async () => {
    const { service, store } = await setup();
    const goal = await service.createGoal({ title: "崩溃恢复" });
    const [operation] = await store.listPushableOutbox("user-a", "9999-01-01T00:00:00.000Z");
    await store.markOutboxAttempt(operation!.opId, 1, null, null);
    const resumed = await store.listPushableOutbox("user-a", "9999-01-01T00:00:00.000Z");
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.opId).toBe(operation?.opId);
    expect(resumed[0]?.entityId).toBe(goal.id);
    expect(resumed[0]?.status).toBe("sending");
  });

  it("fails closed when a corrupted predecessor graph contains a fork", async () => {
    const { database, service, store } = await setup();
    const goal = await service.createGoal({ title: "异常链" });
    const [head] = await database.syncOutbox.where("entityId").equals(goal.id).toArray();
    await database.syncOutbox.add({
      ...head!,
      opId: "00000000-0000-4000-8000-000000000002",
      predecessorOpId: head!.opId,
      createdAt: "2026-09-10T00:00:01.000Z",
    });
    await database.syncOutbox.add({
      ...head!,
      opId: "00000000-0000-4000-8000-000000000003",
      predecessorOpId: head!.opId,
      createdAt: "2026-09-10T00:00:02.000Z",
    });
    await expect(store.listPushableOutbox("user-a", "9999-01-01T00:00:00.000Z"))
      .rejects.toThrow("操作链出现分叉");
    await expect(store.acknowledgeMutation(head!.opId, {
      userId: "user-a", entityType: "goals", entityId: goal.id,
      serverVersion: "1", changeSeq: "1", snapshot: head!.desiredSnapshot,
      isDeleted: false, changedAt: "2026-09-10T00:00:00.000Z",
    })).rejects.toThrow("操作链出现分叉");
  });
});
