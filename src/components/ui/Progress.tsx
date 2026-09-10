interface ProgressProps { value: number; label?: string; tone?: "blue" | "cyan" | "violet"; }
export function Progress({ value, label, tone = "blue" }: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div className="ui-progress" aria-label={label ? `${label}：${safeValue}%` : `进度 ${safeValue}%`}>
    <div className={`ui-progress__bar ui-progress__bar--${tone}`} style={{ width: `${safeValue}%` }} />
  </div>;
}
