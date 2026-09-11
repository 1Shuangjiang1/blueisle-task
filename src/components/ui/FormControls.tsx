import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  initialScrollValue,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
  icon?: "select" | "time";
  initialScrollValue?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("down");
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollTargetRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const scrollValue = value || initialScrollValue;
  useEffect(() => {
    if (!open || !scrollValue) return;
    const frame = window.requestAnimationFrame(() => scrollTargetRef.current?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, scrollValue]);
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
              ref={option.value === scrollValue ? scrollTargetRef : undefined}
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
  const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1];
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>("down");
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentHour = value ? Number(value.slice(0, 2)) : undefined;
  const chooseHour = (hour: number) => setSelectedHour(hour);
  const chooseTime = (time: string) => {
    onChange(time);
    setOpen(false);
    setSelectedHour(null);
  };
  const minuteChoices = selectedHour === null
    ? []
    : [0, 15, 30, 45].map((minute) => `${pad(selectedHour)}:${pad(minute)}`)
      .concat(selectedHour === 1 ? ["02:00"] : []);
  return (
    <div ref={rootRef} className={`custom-field custom-time-field opens-${placement}`}>
      <button type="button" className="custom-field__trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
        setPlacement(bestPlacement(rootRef.current, 300));
        setSelectedHour(null);
        setOpen((current) => !current);
      }}>
        <Clock3 size={17} />
        <span>{value || "不设置"}</span>
        <ChevronDown size={16} />
      </button>
      {open && <div className="time-popover" role="dialog" aria-label={`${ariaLabel}面板`}>
        {selectedHour === null ? <>
          <header><strong>先选择小时</strong><small>10:00 至次日 02:00</small></header>
          <div className="time-hour-grid">
            {hours.map((hour) => <button type="button" className={currentHour === hour || (value === "02:00" && hour === 1) ? "is-selected" : ""} key={hour} onClick={() => chooseHour(hour)}>
              <strong>{pad(hour)} 时</strong><small>{pad(hour)}:00–{pad((hour + 1) % 24)}:00</small>
            </button>)}
          </div>
          <footer><button type="button" onClick={() => chooseTime("")}>不设置时间</button></footer>
        </> : <>
          <header className="time-minute-header"><button type="button" onClick={() => setSelectedHour(null)}><ChevronLeft size={17} /> 返回</button><div><strong>{pad(selectedHour)}:00–{pad((selectedHour + 1) % 24)}:00</strong><small>再选择具体时刻</small></div></header>
          <div className="time-minute-grid">
            {minuteChoices.map((time) => <button type="button" className={value === time ? "is-selected" : ""} key={time} onClick={() => chooseTime(time)}>{time}</button>)}
          </div>
        </>}
      </div>}
    </div>
  );
}
