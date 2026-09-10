import {
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Flag,
  Target,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Progress } from "../components/ui/Progress";
import { StatusPill } from "../components/ui/StatusPill";
import type { PlanningPageProps } from "./types";
import type { LocalDate } from "../domain/models";

const week = ["一", "二", "三", "四", "五", "六", "日"];
const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function PlanningPage({
  month,
  events,
  goals,
  goalProgress = {},
  onMonthChange,
  onAddEvent,
  onOpenEvent,
  onOpenDay,
  onAddGoal,
  onOpenGoal,
}: PlanningPageProps) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((offset + days) / 7) * 7 },
    (_, index) => index - offset + 1,
  );
  const title = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(month);
  const upcoming = events
    .filter(
      (event) => new Date(event.startAt).getTime() >= Date.now() - 86400000,
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <main className="page planning-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">全局规划</p>
          <h1>让重要日期与长期方向同屏出现。</h1>
        </div>
        <div className="button-group">
          <Button onClick={onAddEvent}>
            <Flag size={16} /> 添加日期
          </Button>
          <Button tone="primary" onClick={onAddGoal}>
            <CirclePlus size={16} /> 新建目标
          </Button>
        </div>
      </div>
      <div className="planning-grid">
        <section className="surface calendar-card">
          <div className="calendar-toolbar">
            <button
              className="ui-icon-button"
              aria-label="上一个月"
              onClick={() =>
                onMonthChange?.(
                  new Date(month.getFullYear(), month.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft size={20} />
            </button>
            <h2>{title}</h2>
            <button
              className="ui-icon-button"
              aria-label="下一个月"
              onClick={() =>
                onMonthChange?.(
                  new Date(month.getFullYear(), month.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="calendar-week">
            {week.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {cells.map((day, index) => {
              const key =
                day > 0 && day <= days
                  ? ymd(new Date(month.getFullYear(), month.getMonth(), day))
                  : "";
              const entries = events.filter(
                (event) => event.startAt.slice(0, 10) === key,
              );
              const today = key === ymd(new Date());
              return (
                <div
                  className={`calendar-day ${!key ? "is-blank" : ""} ${today ? "is-today" : ""}`}
                  key={`${day}-${index}`}
                  role={key ? "button" : undefined}
                  tabIndex={key ? 0 : undefined}
                  aria-label={key ? `查看 ${key} 的安排` : undefined}
                  onClick={() => key && onOpenDay?.(key as LocalDate)}
                  onKeyDown={(event) => {
                    if (key && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onOpenDay?.(key as LocalDate);
                    }
                  }}
                >
                  {key && (
                    <>
                      <span>{day}</span>
                      {entries.slice(0, 2).map((event) => (
                        <button
                          key={event.id}
                          className={`calendar-event event--${event.kind}`}
                          title={event.title}
                          onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpenDay?.(key as LocalDate); }}
                        >
                          {event.title}
                        </button>
                      ))}
                      {entries.length > 2 && (
                        <small>+{entries.length - 2} 项</small>
                      )}
                      {entries.length > 0 && <small className="calendar-entry-count">{entries.length} 项事项</small>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="surface upcoming-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">重要日期</p>
              <h2>即将到来</h2>
            </div>
            <Flag size={20} />
          </div>
          {upcoming.length ? (
            <div className="upcoming-list">
              {upcoming.slice(0, 5).map((event) => (
                <button key={event.id} onClick={() => onOpenEvent?.(event)}>
                  <span>{event.startAt.slice(5, 10).replace("-", ".")}</span>
                  <div>
                    <strong>{event.title}</strong>
                    <small>
                      {event.kind === "deadline"
                        ? "截止日期"
                        : event.kind === "interview"
                          ? "面试"
                          : event.kind === "assessment"
                            ? "笔试"
                            : "重要安排"}
                    </small>
                  </div>
                  <StatusPill status="due" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="尚未添加重要日期"
              description="面试、笔试和截止日期会显示在这里。"
            />
          )}
        </aside>
      </div>
      <section className="goals-preview">
        <div className="section-heading">
          <div>
            <p className="eyebrow">近期目标</p>
            <h2>正在推进的方向</h2>
          </div>
          <Button size="sm" onClick={onAddGoal}>
            添加目标
          </Button>
        </div>
        <div className="goal-card-grid">
          {goals.filter((goal) => goal.status === "active").length ? (
            goals
              .filter((goal) => goal.status === "active")
              .map((goal) => {
                const progress = goalProgress[goal.id];
                return (
                  <button
                    className="goal-preview-card"
                    key={goal.id}
                    onClick={() => onOpenGoal?.(goal.id)}
                  >
                    <div>
                      <StatusPill status="active" />
                      <span className="goal-due">
                        {goal.dueDate
                          ? `截止 ${goal.dueDate.slice(5).replace("-", ".")}`
                          : "持续推进"}
                      </span>
                    </div>
                    <h3>{goal.title}</h3>
                    <p>
                      {goal.description || "还没有描述，先从一个小步骤开始。"}
                    </p>
                    <Progress value={progress?.value ?? 0} tone="cyan" />
                    <footer>
                      <span>{progress?.label ?? "尚未设定进度"}</span>
                      <Target size={16} />
                    </footer>
                  </button>
                );
              })
          ) : (
            <EmptyState
              title="还没有近期目标"
              description="把宽泛的方向放在这里，再逐步拆成可执行的步骤。"
              action={
                <Button tone="primary" onClick={onAddGoal}>
                  创建目标
                </Button>
              }
            />
          )}
        </div>
      </section>
    </main>
  );
}
