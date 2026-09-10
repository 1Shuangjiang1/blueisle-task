// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import type { Goal } from "../domain/models";
import type { AppWorkspace } from "./runtime";

const runtimeMock = vi.hoisted(() => ({
  authListener: undefined as ((state: {
    mode: "signed-in";
    configured: true;
    userId: string;
    email: string;
    message: null;
  }) => void) | undefined,
  openWorkspace: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn() } }));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { setStyle: vi.fn(), setBackgroundColor: vi.fn() },
  Style: { Light: "LIGHT", Dark: "DARK" },
}));
vi.mock("../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: unknown }) => children,
}));
vi.mock("../features", () => ({
  TodayPage: ({ goals }: { goals: Goal[] }) => (
    <div data-testid="today-goals">{goals.map((goal) => goal.title).join(",")}</div>
  ),
  GoalDetailPage: () => null,
  GoalsPage: () => null,
  PlanningPage: () => null,
  ReviewPage: () => null,
  SettingsPanel: () => null,
}));
vi.mock("./dialogs", () => ({
  CompleteDialog: () => null,
  EventDialog: () => null,
  GoalDialog: () => null,
  PlanDialog: () => null,
  StepDialog: () => null,
}));
vi.mock("./runtime", () => ({
  appAuth: {
    subscribe: (listener: typeof runtimeMock.authListener) => {
      runtimeMock.authListener = listener;
      listener?.({
        mode: "signed-in",
        configured: true,
        userId: "user-a",
        email: "a@example.com",
        message: null,
      });
      return vi.fn();
    },
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
  initialAccountState: () => ({
    mode: "loading",
    configured: true,
    userId: null,
    email: null,
    message: null,
  }),
  openWorkspace: runtimeMock.openWorkspace,
  resolveWorkspaceConflict: vi.fn(),
}));

import { App } from "./App";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function goal(id: string, title: string): Goal {
  return {
    id,
    title,
    status: "active",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    entityVersion: 1,
  };
}

function workspace(
  accountId: string,
  goals: Promise<Goal[]>,
  unsubscribeSync: () => void,
): AppWorkspace {
  const emptyList = async () => [];
  const service = {
    goals: { list: () => goals },
    goalSteps: { list: emptyList },
    calendarEvents: { list: emptyList },
    planBlocks: { list: emptyList },
    completionLogs: { list: emptyList },
    getSettings: async () => ({
      id: "device-settings",
      theme: "system",
      reduceMotion: false,
      reminderDays: 7,
      updatedAt: "2026-09-10T00:00:00.000Z",
    }),
    getDailyReviewSummary: async (date: string) => ({
      date,
      plannedCount: 0,
      completedCount: 0,
      remainingCount: 0,
      actualMinutes: 0,
      completionLogs: [],
    }),
  } as unknown as AppWorkspace["service"];
  const syncEngine = {
    getState: () => ({ phase: "idle" as const, pendingCount: 0, lastSuccessAt: null, error: null }),
    subscribe: () => unsubscribeSync,
    syncNow: async () => ({ pushed: 0, pulled: 0, conflicts: 0 }),
  };
  const database = {
    close: vi.fn(),
    syncOutbox: { where: () => ({ equals: () => ({ count: async () => 0 }) }) },
    syncConflicts: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
  } as unknown as AppWorkspace["database"];
  return { accountId, service, database, syncEngine };
}

describe("App workspace lifecycle", () => {
  it("freezes the old workspace immediately and rejects its late reload", async () => {
    const staleGoals = deferred<Goal[]>();
    const nextWorkspace = deferred<AppWorkspace>();
    const unsubscribeOldSync = vi.fn();
    const userA = workspace("user-a", staleGoals.promise, unsubscribeOldSync);
    const userB = workspace("user-b", Promise.resolve([goal("b", "账号 B 的任务")]), vi.fn());
    runtimeMock.openWorkspace.mockImplementation((userId: string) =>
      userId === "user-a" ? Promise.resolve(userA) : nextWorkspace.promise,
    );

    render(<App />);
    await waitFor(() => expect(runtimeMock.openWorkspace).toHaveBeenCalledWith("user-a"));
    await waitFor(() => expect(screen.getByTestId("today-goals")).toBeTruthy());

    await act(async () => {
      runtimeMock.authListener?.({
        mode: "signed-in",
        configured: true,
        userId: "user-b",
        email: "b@example.com",
        message: null,
      });
    });

    expect(unsubscribeOldSync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("正在准备你的任务空间…")).toBeTruthy();

    await act(async () => {
      staleGoals.resolve([goal("a", "绝不能回写的账号 A 任务")]);
      await Promise.resolve();
    });
    expect(screen.queryByText("绝不能回写的账号 A 任务")).toBeNull();

    await act(async () => { nextWorkspace.resolve(userB); });
    await waitFor(() => expect(screen.getByText("账号 B 的任务")).toBeTruthy());
    expect(screen.queryByText("绝不能回写的账号 A 任务")).toBeNull();
  });
});
