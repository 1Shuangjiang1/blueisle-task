type Status = "synced" | "pending" | "offline" | "error" | "active" | "completed" | "due";
const labels: Record<Status, string> = { synced: "已同步", pending: "待同步", offline: "离线", error: "同步失败", active: "进行中", completed: "已完成", due: "临近日期" };
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  return <span className={`ui-status ui-status--${status}`}>{label ?? labels[status]}</span>;
}
