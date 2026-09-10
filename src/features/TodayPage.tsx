import { AlarmClock, CalendarDays, Check, ChevronRight, CirclePlus, Clock3, Sparkles } from "lucide-react";
import type { PlanBlock } from "../domain/models";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { StatusPill } from "../components/ui/StatusPill";
import type { TodayPageProps } from "./types";

function timeLabel(plan: PlanBlock) {
  if (plan.startMinute === undefined) return "待安排";
  const display = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return `${display(plan.startMinute)}${plan.endMinute === undefined ? "" : ` — ${display(plan.endMinute)}`}`;
}
function daysUntil(dateString: string) {
  const days = Math.ceil((new Date(dateString).getTime() - Date.now()) / 86400000);
  return days <= 0 ? "今天" : days === 1 ? "明天" : `${days} 天后`;
}
export function TodayPage({ date, reminders, planBlocks, goals, steps, onAddPlan, onEditPlan, onCompletePlan, onOpenGoal }: TodayPageProps) {
  const ordered = [...planBlocks].sort((a, b) => (a.startMinute ?? 9999) - (b.startMinute ?? 9999) || a.order - b.order);
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const focus = ordered.filter((plan) => plan.status === "planned" && plan.goalId).slice(0, 3);
  return <main className="page today-page">
    <div className="page-heading"><div><p className="eyebrow">今日执行 / {date}</p><h1>把注意力留给下一件事。</h1></div><Button tone="primary" onClick={() => onAddPlan?.()}><CirclePlus size={17} /> 添加安排</Button></div>
    <section className="reminder-rail" aria-label="近期重要提醒">
      <div className="section-label"><AlarmClock size={16} /><span>未来 7 日提醒</span></div>
      {reminders.length ? reminders.slice(0, 4).map((event) => <button className="reminder-chip" key={event.id} onClick={() => event.goalId && onOpenGoal?.(event.goalId)}><span>{daysUntil(event.startAt)}</span><strong>{event.title}</strong><ChevronRight size={15} /></button>) : <span className="muted">未来七天没有重要日期，可以安心推进。</span>}
    </section>
    <section className="today-grid">
      <div className="surface focus-card"><div className="section-label"><Sparkles size={16} /><span>今日重点</span></div>
        {focus.length ? <ol className="focus-list">{focus.map((plan) => <li key={plan.id}><span className="focus-index">0{focus.indexOf(plan) + 1}</span><button onClick={() => onEditPlan?.(plan)}>{plan.title}<small>{goalById.get(plan.goalId!)?.title}</small></button></li>)}</ol> : <EmptyState title="今天还没有重点" description="从一个目标开始，安排一段专注时间。" action={<Button size="sm" onClick={() => onAddPlan?.()}>添加安排</Button>} />}
      </div>
      <div className="surface daily-meter"><span className="metric-label">已规划专注时间</span><strong>{Math.round(planBlocks.reduce((total, item) => total + Math.max(0, (item.endMinute ?? item.startMinute ?? 0) - (item.startMinute ?? 0)), 0) / 60 * 10) / 10}<small> h</small></strong><span className="muted">完成后补充真实投入和成果</span></div>
    </section>
    <section className="surface schedule"><div className="section-heading"><div><p className="eyebrow">时间安排</p><h2>今天的节奏</h2></div><CalendarDays size={21} /></div>
      {ordered.length ? <div className="timeline">{ordered.map((plan) => { const goal = plan.goalId ? goalById.get(plan.goalId) : undefined; const step = plan.goalStepId ? stepById.get(plan.goalStepId) : undefined; const done = plan.status === "completed"; return <article className={`plan-row ${done ? "is-done" : ""}`} key={plan.id}><time>{timeLabel(plan)}</time><div className="timeline-dot" /><div className="plan-content"><div><h3>{plan.title}</h3>{goal && <button className="link-label" onClick={() => onOpenGoal?.(goal.id)}>{goal.title}{step ? ` · ${step.title}` : ""}</button>}</div><p>{plan.notes || (goal ? "推进关联目标" : "个人安排")}</p></div><div className="plan-actions">{done ? <StatusPill status="completed" /> : <><Button size="sm" tone="quiet" aria-label={`编辑 ${plan.title}`} onClick={() => onEditPlan?.(plan)}>编辑</Button><Button size="sm" tone="primary" onClick={() => onCompletePlan?.(plan)}><Check size={15} /> 完成</Button></>}</div></article>})}</div> : <EmptyState title="今天是一张空白日程" description="给重要目标留出一个具体时段，开始会更容易。" action={<Button tone="primary" onClick={() => onAddPlan?.()}><Clock3 size={16} /> 安排第一件事</Button>} />}
    </section>
  </main>;
}
