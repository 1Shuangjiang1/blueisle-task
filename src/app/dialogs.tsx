import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  CalendarEvent,
  Goal,
  GoalStep,
  LocalDate,
  PlanBlock,
} from "../domain/models";
import { Button, DateField, Modal, SelectField, TimeField } from "../components/ui";

const minuteToTime = (minute?: number) =>
  minute === undefined
    ? ""
    : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const timeToMinute = (value: string) =>
  value
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
    : undefined;

export function GoalDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (value: {
    title: string;
    description?: string;
    dueDate?: LocalDate;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <Modal title="新建近期目标" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit({
            title,
            description: description || undefined,
            dueDate: (dueDate as LocalDate) || undefined,
          });
        }}
      >
        <label>
          目标名称
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：准备华为笔试"
          />
        </label>
        <label>
          为什么要做
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="写下范围或期待的成果"
          />
        </label>
        <div className="form-field">
          <span className="form-label">关联截止日期（可选）</span>
          <DateField value={dueDate} onChange={setDueDate} ariaLabel="选择目标截止日期" />
        </div>
        <div className="dialog-actions">
          <Button type="button" tone="quiet" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="primary">
            创建目标
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function EventDialog({
  goals,
  editing,
  onClose,
  onDelete,
  onSubmit,
}: {
  goals: Goal[];
  editing?: CalendarEvent;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (value: {
    title: string;
    startAt: string;
    kind: "interview" | "assessment" | "deadline" | "personal" | "other";
    goalId?: string;
    isAllDay: boolean;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [startAt, setStartAt] = useState(editing?.startAt.slice(0, 10) ?? "");
  const [kind, setKind] = useState<
    "interview" | "assessment" | "deadline" | "personal" | "other"
  >(editing?.kind ?? "deadline");
  const [goalId, setGoalId] = useState(editing?.goalId ?? "");
  return (
    <Modal title={editing ? "编辑重要日期" : "添加重要日期"} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!startAt) return;
          await onSubmit({
            title,
            startAt: new Date(`${startAt}T12:00:00`).toISOString(),
            kind,
            goalId: goalId || undefined,
            isAllDay: true,
          });
        }}
      >
        <label>
          事项
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="面试、笔试或作业截止"
          />
        </label>
        <div className="form-field">
          <span className="form-label">日期</span>
          <DateField required value={startAt} onChange={setStartAt} ariaLabel="选择重要日期" />
        </div>
        <div className="form-field">
          <span className="form-label">类型</span>
          <SelectField value={kind} ariaLabel="选择日期类型" onChange={(value) => setKind(value as typeof kind)} options={[
            { value: "interview", label: "面试" }, { value: "assessment", label: "笔试" },
            { value: "deadline", label: "截止日期" }, { value: "personal", label: "个人安排" },
            { value: "other", label: "其他" },
          ]} />
        </div>
        <div className="form-field">
          <span className="form-label">关联目标（可选）</span>
          <SelectField value={goalId} ariaLabel="选择关联目标" onChange={setGoalId} options={[
            { value: "", label: "不关联" }, ...goals.map((goal) => ({ value: goal.id, label: goal.title })),
          ]} />
        </div>
        <div className="dialog-actions">
          {editing && onDelete && <Button className="delete-action" type="button" tone="danger" onClick={onDelete}>删除日期</Button>}
          <Button type="button" tone="quiet" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="primary">
            保存日期
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function StepDialog({
  goalId,
  parentStepId,
  editing,
  onClose,
  onDelete,
  onSubmit,
}: {
  goalId: string;
  parentStepId?: string;
  editing?: GoalStep;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (value: {
    title: string;
    notes?: string;
    parentStepId?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  return (
    <Modal
      title={
        editing ? "编辑步骤" : parentStepId ? "添加子步骤" : "添加目标步骤"
      }
      onClose={onClose}
    >
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit({ title, notes: notes || undefined, parentStepId });
        }}
      >
        <input type="hidden" value={goalId} readOnly />
        <label>
          步骤名称
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：模拟类算法题"
          />
        </label>
        <label>
          说明（可选）
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="dialog-actions">
          {editing && onDelete && <Button className="delete-action" type="button" tone="danger" onClick={onDelete}>删除步骤</Button>}
          <Button type="button" tone="quiet" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="primary">
            保存步骤
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PlanDialog({
  goals,
  steps,
  date,
  preset,
  editing,
  onClose,
  onDelete,
  onSubmit,
}: {
  goals: Goal[];
  steps: GoalStep[];
  date: LocalDate;
  preset?: Partial<PlanBlock>;
  editing?: PlanBlock;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (value: {
    date: LocalDate;
    title: string;
    startMinute?: number;
    endMinute?: number;
    goalId?: string;
    goalStepId?: string;
    notes?: string;
  }) => Promise<void>;
}) {
  const source = editing ?? preset;
  const [title, setTitle] = useState(source?.title ?? "");
  const [planDate, setPlanDate] = useState(source?.date ?? date);
  const [start, setStart] = useState(minuteToTime(source?.startMinute));
  const [end, setEnd] = useState(minuteToTime(source?.endMinute));
  const [goalId, setGoalId] = useState(source?.goalId ?? "");
  const [stepId, setStepId] = useState(source?.goalStepId ?? "");
  const [notes, setNotes] = useState(source?.notes ?? "");
  const availableSteps = useMemo(
    () => steps.filter((step) => step.goalId === goalId),
    [steps, goalId],
  );
  useEffect(() => {
    if (stepId && !availableSteps.some((step) => step.id === stepId))
      setStepId("");
  }, [availableSteps, stepId]);
  return (
    <Modal title={editing ? "编辑今日安排" : "添加今日安排"} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSubmit({
            date: planDate as LocalDate,
            title,
            startMinute: timeToMinute(start),
            endMinute: timeToMinute(end),
            goalId: goalId || undefined,
            goalStepId: stepId || undefined,
            notes: notes || undefined,
          });
        }}
      >
        <label>
          安排内容
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：模拟题训练"
          />
        </label>
        <div className="form-row">
          <div className="form-field">
            <span className="form-label">日期</span>
            <DateField required value={planDate} onChange={(value) => setPlanDate(value as LocalDate)} ariaLabel="选择安排日期" />
          </div>
          <div className="form-field">
            <span className="form-label">开始时间</span>
            <TimeField value={start} onChange={setStart} ariaLabel="选择开始时间" />
          </div>
          <div className="form-field">
            <span className="form-label">结束时间</span>
            <TimeField value={end} onChange={setEnd} ariaLabel="选择结束时间" />
          </div>
        </div>
        <div className="form-field">
          <span className="form-label">所属目标（可选）</span>
          <SelectField value={goalId} ariaLabel="选择所属目标" onChange={setGoalId} options={[
            { value: "", label: "日常或临时安排" }, ...goals.map((goal) => ({ value: goal.id, label: goal.title })),
          ]} />
        </div>
        {goalId && (
          <div className="form-field">
            <span className="form-label">具体步骤（可选）</span>
            <SelectField value={stepId} ariaLabel="选择具体步骤" onChange={setStepId} options={[
              { value: "", label: "只关联目标" }, ...availableSteps.map((step) => ({ value: step.id, label: step.title })),
            ]} />
          </div>
        )}
        <label>
          备注
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="dialog-actions">
          {editing && onDelete && <Button className="delete-action" type="button" tone="danger" onClick={onDelete}>删除安排</Button>}
          <Button type="button" tone="quiet" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="primary">
            保存安排
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDeleteDialog({ title, description, confirmLabel, onClose, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <Modal title={title} onClose={onClose}>
    <div className="delete-confirm">
      <p>{description}</p>
      <div className="dialog-actions">
        <Button type="button" tone="quiet" onClick={onClose}>取消</Button>
        <Button type="button" tone="danger" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  </Modal>;
}

export function CompleteDialog({
  plan,
  onClose,
  onSubmit,
}: {
  plan: PlanBlock;
  onClose: () => void;
  onSubmit: (value: {
    actualMinutes?: number;
    outcome?: string;
    notes?: string;
    nextStep?: string;
  }) => Promise<void>;
}) {
  const planned =
    plan.startMinute !== undefined && plan.endMinute !== undefined
      ? plan.endMinute - plan.startMinute
      : undefined;
  const [minutes, setMinutes] = useState(planned ? String(planned) : "");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextStep, setNextStep] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      actualMinutes: minutes ? Number(minutes) : undefined,
      outcome: outcome || undefined,
      notes: notes || undefined,
      nextStep: nextStep || undefined,
    });
  };
  return (
    <Modal title={`完成：${plan.title}`} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label>
          实际投入（分钟）
          <input
            autoFocus
            min="0"
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
        <label>
          完成成果
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="例如：完成 3 道模拟题"
          />
        </label>
        <label>
          备注
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="记录卡点或经验"
          />
        </label>
        <label>
          下一步
          <input
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
            placeholder="例如：明天复盘未通过的题"
          />
        </label>
        <div className="dialog-actions">
          <Button type="button" tone="quiet" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="primary">
            完成并记录
          </Button>
        </div>
      </form>
    </Modal>
  );
}
