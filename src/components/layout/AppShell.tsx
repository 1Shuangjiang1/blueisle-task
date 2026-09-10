import { CalendarRange, ClipboardCheck, Crosshair, ListTodo, Settings } from "lucide-react";
import type { ReactNode } from "react";

export type AppView = "today" | "planning" | "goals" | "review";
const items: Array<{ id: AppView; label: string; icon: typeof ListTodo }> = [
  { id: "today", label: "今天", icon: ListTodo },
  { id: "planning", label: "规划", icon: CalendarRange },
  { id: "goals", label: "目标", icon: Crosshair },
  { id: "review", label: "回顾", icon: ClipboardCheck },
];

export function AppShell({ view, onViewChange, onOpenSettings, children }: { view: AppView; onViewChange: (view: AppView) => void; onOpenSettings: () => void; children: ReactNode }) {
  return <div className="app-shell"><aside className="app-sidebar"><div className="brand-mark"><span>BI</span><div><strong>蓝屿任务</strong><small>把方向放进今天</small></div></div><nav>{items.map(({id,label,icon:Icon}) => <button key={id} className={view === id ? "is-active" : ""} onClick={() => onViewChange(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><button className="settings-trigger" onClick={onOpenSettings}><Settings size={18}/><span>设置</span></button></aside><div className="app-content">{children}</div><nav className="bottom-nav" aria-label="主导航">{items.map(({id,label,icon:Icon}) => <button key={id} className={view === id ? "is-active" : ""} onClick={() => onViewChange(id)}><Icon size={20}/><span>{label}</span></button>)}<button onClick={onOpenSettings}><Settings size={20}/><span>设置</span></button></nav></div>;
}
