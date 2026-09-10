import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

type Option = { value: string; label: string };
type Placement = "up" | "down";

function bestPlacement(element: HTMLDivElement | null, panelHeight: number): Placement {
  if (!element) return "down";
  const rect = element.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  return below < panelHeight && above > below ? "up" : "down";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
}

export function DateField({
  value,
  onChange,
  required,
  ariaLabel = "选择日期",
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("down");
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => parseDate(value));
  const selected = value ? parseDate(value) : undefined;
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const total = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => index - offset + 1);
  const display = value
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(selected)
    : "请选择日期";

  return (
    <div ref={rootRef} className={`custom-field custom-date-field opens-${placement}`}>
      <button
        type="button"
        className={`custom-field__trigger ${value ? "has-value" : ""}`}
        aria-label={ariaLabel}
        aria-required={required}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setView(parseDate(value));
          setPlacement(bestPlacement(rootRef.current, 306));
          setOpen((current) => !current);
        }}
      >
        <CalendarDays size={17} />
        <span>{display}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="date-popover" role="dialog" aria-label="日期选择面板">
          <header>
            <button type="button" aria-label="上一个月" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
            <strong>{view.getFullYear()}年 {view.getMonth() + 1}月</strong>
            <button type="button" aria-label="下一个月" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
          </header>
          <div className="date-popover__week">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="date-popover__grid">
            {cells.map((day, index) => {
              const date = day > 0 && day <= total ? new Date(view.getFullYear(), view.getMonth(), day) : undefined;
              const key = date ? toLocalDate(date) : "";
              return date ? (
                <button
                  type="button"
                  key={key}
                  className={`${key === value ? "is-selected" : ""} ${key === toLocalDate(new Date()) ? "is-today" : ""}`}
                  onClick={() => { onChange(key); setOpen(false); }}
                >{day}</button>
              ) : <span key={`blank-${index}`} />;
            })}
          </div>
          <footer>
            <button type="button" onClick={() => { const today = toLocalDate(new Date()); onChange(today); setView(new Date()); setOpen(false); }}>今天</button>
            {!required && value && <button type="button" onClick={() => { onChange(""); setOpen(false); }}>清除</button>}
          </footer>
        </div>
      )}
    </div>
  );
}

export function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
  icon = "select",
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
  icon?: "select" | "time";
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("down");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div ref={rootRef} className={`custom-field custom-select-field opens-${placement}`}>
      <button type="button" className="custom-field__trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setPlacement(bestPlacement(rootRef.current, Math.min(224, options.length * 35 + 14))); setOpen((current) => !current); }}>
        {icon === "time" ? <Clock3 size={17} /> : null}
        <span>{selected?.label ?? "请选择"}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="select-popover" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "is-selected" : ""}
              key={option.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <span>{option.label}</span>{option.value === value && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimeField({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const options = useMemo(() => {
    const times: Option[] = [{ value: "", label: "不设置" }];
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const time = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
      times.push({ value: time, label: time });
    }
    if (value && !times.some((option) => option.value === value)) times.push({ value, label: value });
    return times;
  }, [value]);
  return <SelectField value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} icon="time" />;
}
