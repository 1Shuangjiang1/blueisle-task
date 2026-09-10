import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { Goal, SyncOutboxOperation } from "../domain/models";
import type { JsonObject, SyncConflict, SyncShadow } from "../sync/types";
import { TaskDatabase } from "../data/db";
import {
  createRuntimeId,
  resolveWorkspaceConflict,
  type AppWorkspace,
} from "./runtime";

const databases: TaskDatabase[] = [];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const snapshot = (
  title: string,
  description: string,
  updatedAt: string,
  entityVersion: number,
): Goal => ({
  id: "goal-a",
  title,
  description,
  status: "active",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt,
  entityVersion,
});

async function setup(latest: Goal) {
  const database = new TaskDatabase(
    `runtime-conflict-${crypto.randomUUID()}`,
    false,
    "user-a",
  );
  databases.push(database);
  await database.open();
  await database.goals.put(latest);

  const localAtConflict = snapshot(
    "本机原冲突",
    "旧备注",
    "2026-09-10T00:00:01.000Z",
    2,
  );
  const remote = snapshot(
    "云端标题",
    "旧备注",
    "2026-09-10T00:00:01.500Z",
    2,
  );
  const original: SyncOutboxOperation = {
    opId: "00000000-0000-4000-8000-000000000001",
    userId: "user-a",
    entityType: "goals",
    entityId: latest.id,
    baseServerVersion: "1",
    baseSnapshot: snapshot(
      "原始标题",
      "旧备注",
      "2026-09-10T00:00:00.000Z",
      1,
    ) as unknown as JsonObject,
    desiredSnapshot: localAtConflict as unknown as JsonObject,
    predecessorOpId: null,
    createdAt: "2026-09-10T00:00:01.000Z",
    status: "blocked",
    attemptCount: 1,
    nextAttemptAt: null,
    lastError: null,
  };
  const later: SyncOutboxOperation = {
    ...original,
    opId: "00000000-0000-4000-8000-000000000002",
    desiredSnapshot: latest as unknown as JsonObject,
    predecessorOpId: original.opId,
    createdAt: "2026-09-10T00:00:03.000Z",
    status: "queued",
    attemptCount: 0,
  };
  const conflict: SyncConflict = {
    id: "00000000-0000-4000-8000-000000000003",
    userId: "user-a",
    entityType: "goals",
    entityId: latest.id,
    outboxOpId: original.opId,
    baseSnapshot: original.baseSnapshot,
    localSnapshot: localAtConflict as unknown as JsonObject,
    remoteSnapshot: remote as unknown as JsonObject,
    remoteServerVersion: "2",
    conflictFields: ["title"],
    kind: "field",
    status: "unresolved",
    createdAt: "2026-09-10T00:00:02.000Z",
    resolutionOpId: null,
    resolvedAt: null,
  };
  const shadow: SyncShadow & { id: string } = {
    id: "user-a\u0000goals\u0000goal-a",
    userId: "user-a",
    entityType: "goals",
    entityId: latest.id,
    serverVersion: "2",
    changeSeq: "2",
    snapshot: remote as unknown as JsonObject,
    isDeleted: false,
    changedAt: remote.updatedAt,
  };
  await database.syncOutbox.bulkAdd([original, later]);
  await database.syncConflicts.add(conflict);
  await database.syncShadows.add(shadow);
  return {
    database,
    conflict,
    workspace: {
      accountId: "user-a",
      database,
      service: {} as AppWorkspace["service"],
      syncEngine: null,
    } satisfies AppWorkspace,
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

describe("resolveWorkspaceConflict", () => {
  it("adopts the remote conflict fields and keeps a later independent local edit queued", async () => {
    const latest = snapshot(
      "本机原冲突",
      "冲突出现后补充的备注",
      "2026-09-10T00:00:03.000Z",
      3,
    );
    const { database, conflict, workspace } = await setup(latest);

    await resolveWorkspaceConflict(workspace, conflict, "remote");

    expect(await database.goals.get("goal-a")).toMatchObject({
      title: "云端标题",
      description: "冲突出现后补充的备注",
    });
    const recovery = await database.syncOutbox.toArray();
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({
      status: "queued",
      baseServerVersion: "2",
      desiredSnapshot: {
        title: "云端标题",
        description: "冲突出现后补充的备注",
      },
    });
    expect((await database.syncConflicts.get(conflict.id))?.status).toBe("resolved");
  });

  it("creates a new explicit conflict when a later edit changed the same field", async () => {
    const latest = snapshot(
      "冲突出现后再次编辑",
      "旧备注",
      "2026-09-10T00:00:03.000Z",
      3,
    );
    const { database, conflict, workspace } = await setup(latest);

    await resolveWorkspaceConflict(workspace, conflict, "remote");

    expect((await database.goals.get("goal-a"))?.title).toBe("冲突出现后再次编辑");
    const recovery = await database.syncOutbox.toArray();
    expect(recovery).toHaveLength(1);
    expect(recovery[0]).toMatchObject({ status: "blocked", desiredSnapshot: { title: "冲突出现后再次编辑" } });
    const unresolved = (await database.syncConflicts.toArray()).filter(
      (item) => item.status === "unresolved",
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({
      outboxOpId: recovery[0]?.opId,
      localSnapshot: { title: "冲突出现后再次编辑" },
      remoteSnapshot: { title: "云端标题" },
      conflictFields: ["title"],
      status: "unresolved",
    });
  });
});

describe("createRuntimeId", () => {
  it("keeps the legacy fallback inside the UUID v4 range", () => {
    expect(createRuntimeId(null)).toMatch(UUID_V4);
  });
});
