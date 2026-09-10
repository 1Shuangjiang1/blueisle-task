import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountDatabase, TaskDatabase } from "./db";
import { appendSyncOutbox, createTaskService } from "./service";

const databases: TaskDatabase[] = [];

async function makeService() {
  const database = new TaskDatabase(
    `task-data-test-${crypto.randomUUID()}`,
    false,
  );
  databases.push(database);
  await database.open();
  return { database, service: createTaskService(database) };
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe("TaskService", () => {
  it("completes a plan atomically and does not duplicate its completion log", async () => {
    const { database, service } = await makeService();
    const goal = await service.createGoal({ title: "准备笔试" });
    const plan = await service.createPlanBlock({
      title: "模拟题训练",
      date: "2026-09-09",
      goalId: goal.id,
      startMinute: 14 * 60,
      endMinute: 16 * 60,
    });

    const first = await service.completePlanBlock(plan.id, {
      actualMinutes: 90,
      notes: "复盘字符串题",
    });
    const repeated = await service.completePlanBlock(plan.id, {
      actualMinutes: 20,
    });

    expect(repeated.id).toBe(first.id);
    expect((await service.planBlocks.get(plan.id))?.status).toBe("completed");
    expect(
      await database.completionLogs
        .where("planBlockId")
        .equals(plan.id)
        .count(),
    ).toBe(1);
    expect(await service.getGoalActualMinutes(goal.id)).toBe(90);
  });

  it("selects upcoming events, sorts today's timed work, and summarizes a review", async () => {
    const { service } = await makeService();
    const goal = await service.createGoal({ title: "岗位投递" });
    await service.createCalendarEvent({
      title: "下周面试",
      startAt: "2026-09-12T04:00:00.000Z",
      goalId: goal.id,
    });
    await service.createCalendarEvent({
      title: "太远的活动",
      startAt: "2026-10-12T04:00:00.000Z",
    });
    const unscheduled = await service.createPlanBlock({
      title: "整理简历",
      date: "2026-09-09",
      order: 1,
    });
    const timed = await service.createPlanBlock({
      title: "投递岗位",
      date: "2026-09-09",
      startMinute: 540,
      order: 0,
      goalId: goal.id,
    });
    await service.completePlanBlock(timed.id, {
      actualMinutes: 45,
      outcome: "投递 2 个岗位",
    });
    const review = await service.upsertDailyReview("2026-09-09", {
      reflection: "上午效率不错",
      tomorrowFocus: "继续投递",
    });

    expect(
      (
        await service.getUpcomingReminders(new Date("2026-09-09T00:00:00.000Z"))
      ).map((event) => event.title),
    ).toEqual(["下周面试"]);
    expect(
      (await service.getTodayPlan("2026-09-09")).map((block) => block.id),
    ).toEqual([timed.id, unscheduled.id]);
    await service.planBlocks.remove(unscheduled.id);
    const summary = await service.getDailyReviewSummary("2026-09-09");
    expect(summary).toMatchObject({
      plannedCount: 1,
      completedCount: 1,
      remainingCount: 0,
      actualMinutes: 45,
    });
    expect(summary.review?.id).toBe(review.id);
    expect(summary.completionLogs[0]?.outcome).toBe("投递 2 个岗位");
  });

  it("seeds a first-run database only once", async () => {
    const database = new TaskDatabase(`task-data-seed-${crypto.randomUUID()}`);
    databases.push(database);
    await database.open();
    const seeded = await database.goals.count();
    await database.close();
    await database.open();
    expect(seeded).toBe(1);
    expect(await database.goals.count()).toBe(1);
  });

  it("exports and restores a validated backup", async () => {
    const { service } = await makeService();
    await service.createGoal({ title: "准备面试" });
    const backup = await service.exportBackup();
    await service.createGoal({ title: "不会保留的临时目标" });

    await service.importBackup(backup);

    expect((await service.goals.list()).map((goal) => goal.title)).toEqual([
      "准备面试",
    ]);
    await expect(service.importBackup({ version: 99 })).rejects.toThrow(
      "不支持的备份版本",
    );
  });

  it("rejects reversed times, negative completion time, and completing cancelled work", async () => {
    const { service } = await makeService();
    await expect(
      service.createPlanBlock({
        title: "错误时间",
        date: "2026-09-09",
        startMinute: 1080,
        endMinute: 960,
      }),
    ).rejects.toThrow("结束时间必须晚于开始时间");
    const plan = await service.createPlanBlock({
      title: "有效安排",
      date: "2026-09-09",
      startMinute: 960,
      endMinute: 1080,
    });
    await expect(
      service.completePlanBlock(plan.id, { actualMinutes: -10 }),
    ).rejects.toThrow("实际投入不能为负数");
    await service.updatePlanBlock(plan.id, { status: "cancelled" });
    await expect(service.completePlanBlock(plan.id)).rejects.toThrow(
      "已取消的安排不能标记为完成",
    );
  });

  it("writes immutable linked outbox records with each entity mutation", async () => {
    const { database, service } = await makeService();
    const goal = await service.createGoal({ title: "准备笔试" });
    const created = await database.syncOutbox.where("entityId").equals(goal.id).first();
    expect(created).toMatchObject({
      userId: "guest",
      entityType: "goals",
      status: "queued",
      desiredSnapshot: { title: "准备笔试" },
    });

    const updated = await service.goals.update(goal.id, { title: "准备笔试（第一轮）" });
    const operations = await database.syncOutbox
      .where("[userId+entityType+entityId]")
      .equals(["guest", "goals", goal.id])
      .sortBy("createdAt");
    expect(operations).toHaveLength(2);
    expect(operations[1]?.predecessorOpId).toBe(operations[0]?.opId);
    expect((operations[0]?.desiredSnapshot as { title: string }).title).toBe("准备笔试");
    expect((operations[1]?.desiredSnapshot as { title: string }).title).toBe(updated.title);

    await service.goals.remove(goal.id);
    const removed = await database.syncOutbox
      .where("[userId+entityType+entityId]")
      .equals(["guest", "goals", goal.id])
      .sortBy("createdAt");
    expect(removed.at(-1)).toMatchObject({ desiredSnapshot: null, predecessorOpId: operations[1]?.opId });
  });

  it("removes plans, step subtrees, goals, and their related records with sync tombstones", async () => {
    const { database, service } = await makeService();
    const goal = await service.createGoal({ title: "准备面试" });
    const parent = await service.createGoalStep({ goalId: goal.id, title: "算法题" });
    const child = await service.createGoalStep({ goalId: goal.id, parentStepId: parent.id, title: "动态规划" });
    const event = await service.createCalendarEvent({ title: "面试日期", startAt: "2026-09-20T04:00:00.000Z", goalId: goal.id });
    const plan = await service.createPlanBlock({ title: "刷动态规划", date: "2026-09-11", goalId: goal.id, goalStepId: child.id });
    const log = await service.completePlanBlock(plan.id, { actualMinutes: 60 });

    await service.removeGoalStep(parent.id);
    expect(await service.goalSteps.list()).toEqual([]);
    expect(await service.planBlocks.list()).toEqual([]);
    expect(await service.completionLogs.list()).toEqual([]);
    expect((await database.syncOutbox.where("entityId").equals(log.id).sortBy("createdAt")).at(-1)?.desiredSnapshot).toBeNull();

    const remainingPlan = await service.createPlanBlock({ title: "整理项目", date: "2026-09-12", goalId: goal.id });
    await service.completePlanBlock(remainingPlan.id, { actualMinutes: 30 });
    await service.removeGoal(goal.id);

    expect(await service.goals.list()).toEqual([]);
    expect(await service.calendarEvents.list()).toEqual([]);
    expect(await service.planBlocks.list()).toEqual([]);
    expect(await service.completionLogs.list()).toEqual([]);
    for (const id of [goal.id, event.id, remainingPlan.id]) {
      expect((await database.syncOutbox.where("entityId").equals(id).sortBy("createdAt")).at(-1)?.desiredSnapshot).toBeNull();
    }
  });

  it("links a new mutation to the graph tail even when stored timestamps go backwards", async () => {
    const { database, service } = await makeService();
    const goal = await service.createGoal({ title: "时钟回退" });
    const [first] = await database.syncOutbox.toArray();
    await database.syncOutbox.put({ ...first!, createdAt: "2099-01-01T00:00:00.000Z" });
    const second = await service.goals.update(goal.id, { title: "第二次" });
    const initialChain = await database.syncOutbox.where("entityId").equals(goal.id).toArray();
    const head = initialChain.find((operation) => !operation.predecessorOpId)!;
    const tail = initialChain.find((operation) => operation.predecessorOpId === head.opId)!;
    expect(tail!.predecessorOpId).toBe(head!.opId);
    await database.syncOutbox.put({ ...tail!, createdAt: "1900-01-01T00:00:00.000Z" });
    await database.transaction("rw", database.syncOutbox, database.syncShadows, async () => {
      await appendSyncOutbox(database, "goals", second);
    });
    const chain = await database.syncOutbox.where("entityId").equals(goal.id).toArray();
    const last = chain.find((operation) => !chain.some((other) => other.predecessorOpId === operation.opId));
    expect(last!.predecessorOpId).toBe(tail!.opId);
  });

  it("serializes concurrent app instances into one predecessor chain", async () => {
    const { database, service } = await makeService();
    const secondDatabase = new TaskDatabase(database.name, false, "guest");
    databases.push(secondDatabase);
    await secondDatabase.open();
    const goal = await service.createGoal({ title: "跨实例" });
    const goalSnapshot = await database.goals.get(goal.id);
    await Promise.all([
      database.transaction("rw", database.syncOutbox, database.syncShadows, async () => {
        await appendSyncOutbox(database, "goals", { ...goalSnapshot!, title: "A" });
      }),
      secondDatabase.transaction("rw", secondDatabase.syncOutbox, secondDatabase.syncShadows, async () => {
        await appendSyncOutbox(secondDatabase, "goals", { ...goalSnapshot!, title: "B" });
      }),
    ]);
    const operations = await database.syncOutbox.where("entityId").equals(goal.id).toArray();
    const roots = operations.filter((operation) => !operation.predecessorOpId);
    expect(operations).toHaveLength(3);
    expect(roots).toHaveLength(1);
    expect(new Set(operations.map((operation) => operation.opId))).toHaveLength(3);
    expect(operations.every((operation) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.opId))).toBe(true);
  });

  it("rolls back an entity write when its outbox append fails", async () => {
    const { database, service } = await makeService();
    const rejectOutbox = () => {
      throw new Error("outbox unavailable");
    };
    database.syncOutbox.hook("creating", rejectOutbox);
    await expect(service.createGoal({ title: "不能部分写入" })).rejects.toThrow("outbox unavailable");
    database.syncOutbox.hook("creating").unsubscribe(rejectOutbox);
    expect(await database.goals.count()).toBe(0);
    expect(await database.syncOutbox.count()).toBe(0);
  });

  it("uses deterministic review and completion ids and groups completion mutations", async () => {
    const { database, service } = await makeService();
    const plan = await service.createPlanBlock({ title: "练习", date: "2026-09-10" });
    const log = await service.completePlanBlock(plan.id);
    const review = await service.upsertDailyReview("2026-09-10", { reflection: "完成" });
    expect(log.id).toBe(`completion:${plan.id}`);
    expect(review.id).toBe("daily-review:2026-09-10");
    const group = (await database.syncOutbox.toArray()).find(
      (operation) => operation.entityType === "planBlocks" && operation.entityId === plan.id && operation.transactionGroup,
    )?.transactionGroup;
    const completionOps = await database.syncOutbox
      .where("transactionGroup")
      .equals(group ?? "")
      .toArray();
    expect(completionOps.map((operation) => operation.entityType).sort()).toEqual([
      "completionLogs",
      "planBlocks",
    ]);
  });

  it("upgrades an existing v1 database and creates isolated unseeded account stores", async () => {
    const name = `task-data-v1-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      goals: "id, status, dueDate, calendarEventId, updatedAt, deletedAt",
      goalSteps: "id, goalId, parentStepId, [goalId+order], updatedAt, deletedAt",
      calendarEvents: "id, startAt, goalId, kind, updatedAt, deletedAt",
      planBlocks: "id, date, status, goalId, goalStepId, [date+order], [date+startMinute], updatedAt, deletedAt",
      completionLogs: "id, planBlockId, goalId, goalStepId, completedAt, updatedAt, deletedAt",
      dailyReviews: "id, date, updatedAt, deletedAt",
      deviceSettings: "id, updatedAt",
    });
    await legacy.open();
    await legacy.table("goals").add({ id: "legacy-goal", title: "旧目标" });
    legacy.close();

    const upgraded = new TaskDatabase(name, false);
    databases.push(upgraded);
    await upgraded.open();
    expect(await upgraded.goals.get("legacy-goal")).toMatchObject({ title: "旧目标" });
    expect(upgraded.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      "syncOutbox", "syncShadows", "syncConflicts", "syncMeta",
    ]));

    const account = createAccountDatabase(`user-${crypto.randomUUID()}`, { databasePrefix: name });
    databases.push(account);
    await account.open();
    expect(account.accountId).toMatch(/^user-/);
    expect(await account.goals.count()).toBe(0);
  });
});
