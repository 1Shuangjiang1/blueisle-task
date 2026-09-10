import { Cloud, Laptop, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/Button";
import type { SyncConflictPanelProps } from "./types";

const entityLabels = {
  goals: "目标",
  goalSteps: "目标步骤",
  calendarEvents: "重要日期",
  planBlocks: "日程安排",
  completionLogs: "完成记录",
  dailyReviews: "每日回顾",
} as const;

export function SyncConflictPanel({ conflicts, resolvingId, onResolve }: SyncConflictPanelProps) {
  if (!conflicts.length) return null;
  return (
    <section className="sync-conflict-panel" aria-labelledby="sync-conflicts-heading">
      <div className="sync-conflict-panel__heading">
        <TriangleAlert size={18} aria-hidden="true" />
        <div>
          <h3 id="sync-conflicts-heading">需要确认的同步差异</h3>
          <p>同一内容在不同设备被改动。当前版本请保留本机或采用云端内容后再同步。</p>
        </div>
      </div>
      <div className="sync-conflict-list">
        {conflicts.map((conflict) => {
          const waiting = resolvingId === conflict.id;
          const fields = conflict.conflictFields.length
            ? conflict.conflictFields.map((field) => field === "$deleted" ? "删除状态" : field).join("、")
            : "内容";
          return (
            <article className="sync-conflict" key={conflict.id}>
              <div className="sync-conflict__meta">
                <strong>{entityLabels[conflict.entityType]}</strong>
                <span>差异字段：{fields}</span>
              </div>
              <div className="sync-conflict__choices" role="group" aria-label={`处理${entityLabels[conflict.entityType]}冲突`}>
                <Button size="sm" tone="secondary" disabled={waiting} onClick={() => onResolve?.(conflict, "local")}>
                  <Laptop size={14} /> 保留本机
                </Button>
                <Button size="sm" tone="secondary" disabled={waiting} onClick={() => onResolve?.(conflict, "remote")}>
                  <Cloud size={14} /> 采用云端
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
