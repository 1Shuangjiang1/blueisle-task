import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { DateField } from "../components/ui/FormControls";
import type { ReviewPageProps } from "./types";

function combinedReview(summary: ReviewPageProps["summary"]) {
  const review = summary.review;
  if (!review) return "";
  return [
    review.reflection,
    review.blockers ? `卡点与变化：\n${review.blockers}` : "",
    review.tomorrowFocus ? `明日重点：\n${review.tomorrowFocus}` : "",
  ].filter(Boolean).join("\n\n");
}

export function ReviewPage({ summary, planBlocks, onChangeDate, onSaveReview, onReschedule }: ReviewPageProps) {
  const [reviewText, setReviewText] = useState(() => combinedReview(summary));
  useEffect(() => { setReviewText(combinedReview(summary)); }, [summary.date, summary.review]);
  const remaining = planBlocks.filter((plan) => plan.status === "planned");
  return <main className="page review-page"><div className="page-heading"><div><p className="eyebrow">每日回顾</p><h1>看清今天实际推进了什么。</h1></div><div className="date-picker"><CalendarDays size={16}/><DateField value={summary.date} onChange={(value) => onChangeDate?.(value as typeof summary.date)} ariaLabel="选择回顾日期" /></div></div>
    <section className="review-metrics"><div className="surface"><CheckCircle2 size={19}/><strong>{summary.completedCount}<small> / {summary.plannedCount}</small></strong><span>完成安排</span></div><div className="surface"><Clock3 size={19}/><strong>{Math.round(summary.actualMinutes / 6) / 10}<small> h</small></strong><span>真实投入</span></div><div className="surface"><FileText size={19}/><strong>{summary.completionLogs.length}</strong><span>留下完成记录</span></div></section>
    <section className="surface review-workbench">
      <div className="completion-records"><div className="section-heading"><div><p className="eyebrow">自动汇总</p><h2>今天留下的成果</h2></div></div>{summary.completionLogs.length ? summary.completionLogs.map((log) => <article key={log.id}><span className="record-mark"><CheckCircle2 size={16}/></span><div><strong>{log.outcome || "已完成一项安排"}</strong>{log.notes && <p>{log.notes}</p>}{log.nextStep && <small>下一步：{log.nextStep}</small>}</div>{log.actualMinutes && <span>{log.actualMinutes} min</span>}</article>) : <EmptyState title="完成记录会自动出现在这里" description="完成安排时写下成果或备注，就能在回顾里看到。" />}</div>
      <div className="review-form"><div className="section-heading"><div><p className="eyebrow">你的判断</p><h2>写给明天的自己</h2></div></div><label>今日总结<textarea className="review-summary-input" value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder={"写下今天的收获、遇到的卡点，以及明天最值得继续的一件事。\n\n不必按固定格式，想到什么就写什么。"} /></label><Button tone="primary" onClick={() => onSaveReview?.({reflection: reviewText, blockers: "", tomorrowFocus: ""})}>保存今日回顾</Button></div>
    </section>
    <section className="surface remaining-card"><div className="section-heading"><div><p className="eyebrow">未完成安排</p><h2>{remaining.length ? "为它们决定去向" : "今天的安排已处理完"}</h2></div></div>{remaining.map((plan) => <article key={plan.id}><strong>{plan.title}</strong><div><Button size="sm" tone="quiet" onClick={() => onReschedule?.(plan, "backlog")}>退回待安排</Button><Button size="sm" onClick={() => onReschedule?.(plan, "tomorrow")}>移到明天 <ArrowRight size={14}/></Button></div></article>)}</section>
  </main>;
}
