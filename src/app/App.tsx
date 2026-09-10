import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import type {
  CalendarEvent,
  CompletionLog,
  DailyReviewSummary,
  DeviceSettings,
  Goal,
  GoalStep,
  LocalDate,
  PlanBlock,
} from "../domain/models";
import type { TaskService } from "../data/service";
import type { AccountState } from "../auth";
import type { SyncConflict, SyncState } from "../sync/types";
import {
  GoalDetailPage,
  GoalsPage,
  PlanningPage,
  ReviewPage,
  SettingsPanel,
  TodayPage,
} from "../features";
import type { GoalProgress } from "../features/types";
import { AppShell, type AppView } from "../components/layout/AppShell";
import {
  CompleteDialog,
  EventDialog,
  GoalDialog,
  PlanDialog,
  StepDialog,
} from "./dialogs";
import {
  appAuth,
  initialAccountState,
  openWorkspace,
  resolveWorkspaceConflict,
  type AppWorkspace,
} from "./runtime";
import { checkForUpdate } from "../update/updater";

const todayLocal = (): LocalDate => {
  const now = new Date();
  const adjusted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10) as LocalDate;
};
const emptySummary = (date: LocalDate): DailyReviewSummary => ({
  date,
  plannedCount: 0,
  completedCount: 0,
  remainingCount: 0,
  actualMinutes: 0,
  completionLogs: [],
});
type Dialog =
  | { type: "goal" }
  | { type: "event"; editing?: CalendarEvent }
  | { type: "plan"; preset?: Partial<PlanBlock>; editing?: PlanBlock }
  | { type: "complete"; plan: PlanBlock }
  | { type: "step"; goalId: string; parentStepId?: string; editing?: GoalStep }
  | null;

export function App() {
  const today = todayLocal();
  const [view, setView] = useState<AppView>("today");
  const [selectedGoalId, setSelectedGoalId] = useState<string>();
  const [reviewDate, setReviewDate] = useState<LocalDate>(today);
  const [month, setMonth] = useState(() => new Date());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<AppWorkspace | null>(null);
  const [account, setAccount] = useState<AccountState>(initialAccountState);
  const [syncState, setSyncState] = useState<SyncState>({
    phase: "offline",
    pendingCount: 0,
    lastSuccessAt: null,
    error: null,
  });
  const [conflicts, setConflicts] = useState<readonly SyncConflict[]>([]);
  const workspaceVersion = useRef(0);
  const activeWorkspace = useRef<AppWorkspace | null>(null);
  const detachWorkspaceSync = useRef<(() => void) | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [steps, setSteps] = useState<GoalStep[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [plans, setPlans] = useState<PlanBlock[]>([]);
  const [logs, setLogs] = useState<CompletionLog[]>([]);
  const [settings, setSettings] = useState<DeviceSettings>({
    id: "device-settings",
    theme: "system",
    reduceMotion: false,
    reminderDays: 7,
    updatedAt: "",
  });
  const [reviewSummary, setReviewSummary] = useState(emptySummary(reviewDate));
  const isCurrentWorkspace = useCallback(
    (active: AppWorkspace, generation: number) =>
      generation === workspaceVersion.current && activeWorkspace.current === active,
    [],
  );
  const refreshSyncState = useCallback(async (active: AppWorkspace, generation: number) => {
    if (!isCurrentWorkspace(active, generation)) return;
    if (!active.accountId || !active.syncEngine) {
      if (!isCurrentWorkspace(active, generation)) return;
      setSyncState({ phase: "offline", pendingCount: 0, lastSuccessAt: null, error: null });
      setConflicts([]);
      return;
    }
    const [pending, unresolved] = await Promise.all([
      active.database.syncOutbox.where("userId").equals(active.accountId).count(),
      active.database.syncConflicts.where("userId").equals(active.accountId).toArray(),
    ]);
    if (!isCurrentWorkspace(active, generation)) return;
    setSyncState({ ...active.syncEngine.getState(), pendingCount: pending });
    setConflicts(unresolved.filter((item) => item.status !== "resolved"));
  }, [isCurrentWorkspace]);
  const reloadWorkspace = useCallback(async (active: AppWorkspace, generation: number) => {
    if (!isCurrentWorkspace(active, generation)) return;
    const service = active.service;
    const [
      nextGoals,
      nextSteps,
      nextEvents,
      nextPlans,
      nextLogs,
      nextSettings,
      nextSummary,
    ] = await Promise.all([
      service.goals.list(),
      service.goalSteps.list(),
      service.calendarEvents.list(),
      service.planBlocks.list(),
      service.completionLogs.list(),
      service.getSettings(),
      service.getDailyReviewSummary(reviewDate),
    ]);
    if (!isCurrentWorkspace(active, generation)) return;
    setGoals(nextGoals);
    setSteps(nextSteps);
    setEvents(nextEvents);
    setPlans(nextPlans);
    setLogs(nextLogs);
    setSettings(nextSettings);
    setReviewSummary(nextSummary);
    await refreshSyncState(active, generation);
  }, [isCurrentWorkspace, refreshSyncState, reviewDate]);
  const reload = useCallback(async () => {
    const active = activeWorkspace.current;
    if (!active) return;
    await reloadWorkspace(active, workspaceVersion.current);
  }, [reloadWorkspace]);
  useEffect(() => {
    let disposed = false;
    const activate = async (state: AccountState) => {
      if (state.mode === "loading") return;
      const accountId = state.userId ?? null;
      const existing = activeWorkspace.current;
      if (existing?.accountId === accountId) {
        setLoading(false);
        return;
      }

      // Auth events carry the user id, so invalidate the old boundary before
      // opening IndexedDB or doing any other asynchronous work.
      const version = ++workspaceVersion.current;
      detachWorkspaceSync.current?.();
      detachWorkspaceSync.current = null;
      activeWorkspace.current = null;
      setWorkspace(null);
      setLoading(true);
      setDialog(null);
      setSettingsOpen(false);
      setSelectedGoalId(undefined);
      setGoals([]);
      setSteps([]);
      setEvents([]);
      setPlans([]);
      setLogs([]);
      setReviewSummary(emptySummary(todayLocal()));
      setConflicts([]);
      setSyncState({ phase: "offline", pendingCount: 0, lastSuccessAt: null, error: null });
      if (existing?.accountId) existing.database.close();

      try {
        const next = await openWorkspace(accountId);
        if (disposed || version !== workspaceVersion.current) {
          if (next.accountId) next.database.close();
          return;
        }
        activeWorkspace.current = next;
        setWorkspace(next);
        setLoading(false);
      } catch (error) {
        if (disposed || version !== workspaceVersion.current) return;
        setNotice(error instanceof Error ? error.message : "无法打开任务数据");
        setLoading(false);
      }
    };
    const unsubscribe = appAuth.subscribe((state) => {
      if (disposed) return;
      setAccount(state);
      void activate(state);
    });
    return () => {
      disposed = true;
      ++workspaceVersion.current;
      detachWorkspaceSync.current?.();
      detachWorkspaceSync.current = null;
      activeWorkspace.current = null;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (workspace) void reload();
  }, [reload, workspace]);
  useEffect(() => {
    if (!workspace?.syncEngine) return;
    const generation = workspaceVersion.current;
    const active = workspace;
    const engine = workspace.syncEngine;
    const unsubscribe = engine.subscribe((next) => {
      if (!isCurrentWorkspace(active, generation)) return;
      setSyncState(next);
      void refreshSyncState(active, generation);
    });
    const syncWhenUseful = () => {
      if (
        isCurrentWorkspace(active, generation) &&
        document.visibilityState !== "hidden" &&
        navigator.onLine !== false
      ) {
        void engine.syncNow()
          .then(() => reloadWorkspace(active, generation))
          .catch(() => undefined);
      }
    };
    let nativeListener: { remove(): Promise<void> } | undefined;
    let detached = false;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) syncWhenUseful();
      }).then((listener) => {
        nativeListener = listener;
        if (detached) void listener.remove();
      });
    }
    window.addEventListener("online", syncWhenUseful);
    document.addEventListener("visibilitychange", syncWhenUseful);
    if (navigator.onLine !== false) {
      void engine.syncNow()
        .then(() => reloadWorkspace(active, generation))
        .catch(() => undefined);
    }
    const detach = () => {
      if (detached) return;
      detached = true;
      unsubscribe();
      window.removeEventListener("online", syncWhenUseful);
      document.removeEventListener("visibilitychange", syncWhenUseful);
      void nativeListener?.remove();
    };
    detachWorkspaceSync.current = detach;
    return () => {
      detach();
      if (detachWorkspaceSync.current === detach) detachWorkspaceSync.current = null;
    };
  }, [isCurrentWorkspace, refreshSyncState, reloadWorkspace, workspace]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    const active = activeWorkspace.current;
    const generation = workspaceVersion.current;
    if (!active) return;
    try {
      await action();
      if (!isCurrentWorkspace(active, generation)) return;
      await reloadWorkspace(active, generation);
      if (!isCurrentWorkspace(active, generation)) return;
      setDialog(null);
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2400);
    } catch (error) {
      if (!isCurrentWorkspace(active, generation)) return;
      setNotice(error instanceof Error ? error.message : "操作失败，请重试");
    }
  };
  const service: TaskService | null = workspace?.service ?? null;
  const todayPlans = plans.filter((item) => item.date === today);
  const reminders = events
    .filter((event) => {
      const at = new Date(event.startAt).getTime();
      return (
        at >= Date.now() - 86400000 &&
        at <= Date.now() + settings.reminderDays * 86400000
      );
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const progress = useMemo(
    () =>
      Object.fromEntries(
        goals.map((goal) => {
          const ownSteps = steps.filter((step) => step.goalId === goal.id);
          const done = ownSteps.filter((step) => step.isCompleted).length;
          const actualMinutes = logs
            .filter((log) => log.goalId === goal.id)
            .reduce((sum, log) => sum + (log.actualMinutes ?? 0), 0);
          return [
            goal.id,
            {
              value: ownSteps.length
                ? Math.round((done / ownSteps.length) * 100)
                : 0,
              label: ownSteps.length
                ? `${done}/${ownSteps.length} 个步骤完成`
                : "等待拆分第一步",
              actualMinutes,
            } satisfies GoalProgress,
          ];
        }),
      ),
    [goals, steps, logs],
  );
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId);
  const actualTheme =
    settings.theme === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "cyber"
        : "light"
      : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = actualTheme;
    document.documentElement.dataset.reduceMotion = String(
      settings.reduceMotion,
    );
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        actualTheme === "cyber" ? "#070b16" : "#edf4fa",
      );
    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({
        style: actualTheme === "cyber" ? Style.Light : Style.Dark,
      });
      void StatusBar.setBackgroundColor({
        color: actualTheme === "cyber" ? "#070b16" : "#edf4fa",
      });
    }
  }, [actualTheme, settings.reduceMotion]);
  const openGoal = (id: string) => {
    setSelectedGoalId(id);
    setView("goals");
  };
  const exportData = async () => {
    if (!service) return;
    const payload = await service.exportBackup();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `蓝屿任务备份-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("本地备份已导出");
  };
  const importData = async (file: File) => {
    const active = activeWorkspace.current;
    const generation = workspaceVersion.current;
    if (!service || !active) return;
    if (account.mode === "signed-in") {
      setNotice("已登录时不能用备份替换账号数据；请先退出账号后恢复本地备份。");
      return;
    }
    try {
      const payload: unknown = JSON.parse(await file.text());
      if (!isCurrentWorkspace(active, generation)) return;
      if (!window.confirm("恢复备份会替换当前设备上的任务数据。确定继续吗？")) return;
      await service.importBackup(payload);
      if (!isCurrentWorkspace(active, generation)) return;
      await reloadWorkspace(active, generation);
      if (!isCurrentWorkspace(active, generation)) return;
      setNotice("备份已恢复");
    } catch (error) {
      if (!isCurrentWorkspace(active, generation)) return;
      setNotice(error instanceof Error ? error.message : "备份恢复失败");
    }
  };
  const renderPage = () => {
    if (loading)
      return (
        <div className="loading-screen">
          <span />
          正在准备你的任务空间…
        </div>
      );
    if (view === "today")
      return (
        <TodayPage
          date={today}
          reminders={reminders}
          planBlocks={todayPlans}
          goals={goals}
          steps={steps}
          onAddPlan={(preset) => setDialog({ type: "plan", preset })}
          onEditPlan={(editing) => setDialog({ type: "plan", editing })}
          onCompletePlan={(plan) => setDialog({ type: "complete", plan })}
          onOpenGoal={openGoal}
        />
      );
    if (view === "planning")
      return (
        <PlanningPage
          month={month}
          events={events}
          goals={goals}
          goalProgress={progress}
          onMonthChange={setMonth}
          onAddEvent={() => setDialog({ type: "event" })}
          onOpenEvent={(editing) => setDialog({ type: "event", editing })}
          onAddGoal={() => setDialog({ type: "goal" })}
          onOpenGoal={openGoal}
        />
      );
    if (view === "review")
      return (
        <ReviewPage
          summary={reviewSummary}
          planBlocks={plans.filter((item) => item.date === reviewDate)}
          onChangeDate={setReviewDate}
          onSaveReview={(changes) =>
            run(
              () => service!.upsertDailyReview(reviewDate, changes),
              "今日回顾已保存",
            )
          }
          onReschedule={(plan, action) =>
            run(async () => {
              if (action === "tomorrow") {
                const next = new Date(`${plan.date}T12:00:00`);
                next.setDate(next.getDate() + 1);
                await service!.updatePlanBlock(plan.id, {
                  date: next.toISOString().slice(0, 10) as LocalDate,
                });
              } else if (action === "backlog")
                await service!.updatePlanBlock(plan.id, {
                  startMinute: undefined,
                  endMinute: undefined,
                });
              else if (action === "cancel")
                await service!.updatePlanBlock(plan.id, {
                  status: "cancelled",
                });
            }, "安排已调整")
          }
        />
      );
    if (selectedGoal)
      return (
        <GoalDetailPage
          goal={selectedGoal}
          steps={steps.filter((step) => step.goalId === selectedGoal.id)}
          planBlocks={plans.filter((plan) => plan.goalId === selectedGoal.id)}
          completionLogs={logs.filter((log) => log.goalId === selectedGoal.id)}
          progress={progress[selectedGoal.id]}
          onBack={() => setSelectedGoalId(undefined)}
          onAddStep={(parentStepId) =>
            setDialog({ type: "step", goalId: selectedGoal.id, parentStepId })
          }
          onEditStep={(editing) =>
            setDialog({ type: "step", goalId: selectedGoal.id, editing })
          }
          onToggleStep={(step) =>
            run(
              () =>
                service!.goalSteps.update(step.id, {
                  isCompleted: !step.isCompleted,
                  completedAt: !step.isCompleted
                    ? new Date().toISOString()
                    : undefined,
                  progressValue: !step.isCompleted
                    ? (step.progressTarget ?? 1)
                    : 0,
                }),
              "步骤状态已更新",
            )
          }
          onAddPlan={(preset) => setDialog({ type: "plan", preset })}
        />
      );
    return (
      <GoalsPage
        goals={goals}
        goalProgress={progress}
        onAddGoal={() => setDialog({ type: "goal" })}
        onOpenGoal={openGoal}
      />
    );
  };
  return (
    <div data-theme={actualTheme}>
      <AppShell
        view={view}
        onViewChange={(next) => {
          setView(next);
          if (next !== "goals") setSelectedGoalId(undefined);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {renderPage()}
      </AppShell>
      {settingsOpen && (
        <>
          <button
            className="panel-scrim"
            aria-label="关闭设置"
            onClick={() => setSettingsOpen(false)}
          />
          <SettingsPanel
            theme={settings.theme}
            reduceMotion={settings.reduceMotion}
            syncState="offline"
            account={account}
            sync={{ ...syncState, conflicts }}
            onClose={() => setSettingsOpen(false)}
            onThemeChange={(theme) =>
              run(() => service!.updateSettings({ theme }), "主题已切换")
            }
            onReduceMotionChange={(reduceMotion) =>
              run(
                () => service!.updateSettings({ reduceMotion }),
                "动态效果设置已保存",
              )
            }
            onExport={exportData}
            onImport={importData}
            backupRestoreDisabled={account.mode === "signed-in"}
            backupRestoreHint={account.mode === "signed-in" ? "为避免覆盖云端账号数据，登录期间不能用备份替换数据。退出账号后可恢复本地备份。" : undefined}
            onSignIn={async (email, password) => {
              await appAuth.signIn(email, password);
              setNotice("登录成功，正在打开你的同步任务空间");
            }}
            onSignUp={async (email, password) => {
              const result = await appAuth.signUp(email, password);
              setNotice(result.needsEmailConfirmation ? "验证邮件已发送，请完成验证后登录" : "账号已创建，正在打开同步任务空间");
              return result;
            }}
            onSignOut={async () => {
              await appAuth.signOut();
              setNotice("已退出账号，已切回本机任务空间");
            }}
            onSyncNow={async () => {
              const active = activeWorkspace.current;
              const generation = workspaceVersion.current;
              if (!active?.syncEngine) throw new Error("请先登录并配置同步服务");
              await active.syncEngine.syncNow();
              if (!isCurrentWorkspace(active, generation)) return;
              await reloadWorkspace(active, generation);
              if (!isCurrentWorkspace(active, generation)) return;
              setNotice("同步完成");
            }}
            onResolveConflict={async (conflict, choice) => {
              if (choice === "merge") throw new Error("当前版本请保留本机或采用云端内容");
              const active = activeWorkspace.current;
              const generation = workspaceVersion.current;
              if (!active) throw new Error("任务空间尚未准备好");
              await resolveWorkspaceConflict(active, conflict, choice);
              if (!isCurrentWorkspace(active, generation)) return;
              if (active.syncEngine) await active.syncEngine.syncNow();
              if (!isCurrentWorkspace(active, generation)) return;
              await reloadWorkspace(active, generation);
              if (!isCurrentWorkspace(active, generation)) return;
              setNotice(choice === "local" ? "已保留本机内容并同步" : "已采用云端内容");
            }}
            onCheckUpdate={async () => {
              try {
                setNotice("正在检查新版本…");
                const result = await checkForUpdate();
                if (result.status === "unsupported") {
                  setNotice("Windows 安装版支持应用内更新；安卓版本更新时需确认安装新 APK");
                  return;
                }
                if (result.status === "current") {
                  setNotice("当前已经是最新版本");
                  return;
                }
                if (!window.confirm(`发现新版本 ${result.version}，现在下载并安装吗？`)) {
                  setNotice("已取消本次更新");
                  return;
                }
                setNotice("正在下载并安装更新，请稍候…");
                await result.install();
              } catch (error) {
                setNotice(error instanceof Error ? `检查更新失败：${error.message}` : "检查更新失败，请稍后重试");
              }
            }}
          />
        </>
      )}
      {dialog?.type === "goal" && (
        <GoalDialog
          onClose={() => setDialog(null)}
          onSubmit={(value) =>
            run(() => service!.createGoal(value), "目标已创建")
          }
        />
      )}{" "}
      {dialog?.type === "event" && (
        <EventDialog
          goals={goals}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSubmit={(value) =>
            run(
              () => dialog.editing ? service!.calendarEvents.update(dialog.editing.id, value) : service!.createCalendarEvent(value),
              dialog.editing ? "重要日期已更新" : "重要日期已添加",
            )
          }
        />
      )}{" "}
      {dialog?.type === "plan" && (
        <PlanDialog
          goals={goals}
          steps={steps}
          date={today}
          preset={dialog.preset}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSubmit={(value) =>
            run(
              () =>
                dialog.editing
                  ? service!.updatePlanBlock(dialog.editing.id, value)
                  : service!.createPlanBlock(value),
              dialog.editing ? "安排已更新" : "安排已添加",
            )
          }
        />
      )}{" "}
      {dialog?.type === "complete" && (
        <CompleteDialog
          plan={dialog.plan}
          onClose={() => setDialog(null)}
          onSubmit={(value) =>
            run(
              () => service!.completePlanBlock(dialog.plan.id, value),
              "已记录本次完成",
            )
          }
        />
      )}{" "}
      {dialog?.type === "step" && (
        <StepDialog
          goalId={dialog.goalId}
          parentStepId={dialog.parentStepId}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSubmit={(value) =>
            run(
              () =>
                dialog.editing
                  ? service!.goalSteps.update(dialog.editing.id, value)
                  : service!.createGoalStep({
                      goalId: dialog.goalId,
                      ...value,
                    }),
              dialog.editing ? "步骤已更新" : "步骤已添加",
            )
          }
        />
      )}{" "}
      {notice && (
        <div className="app-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
