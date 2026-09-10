import { Cloud, Download, KeyRound, LogIn, LogOut, Moon, RefreshCw, Sun, Upload, UserRound, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { StatusPill } from "../components/ui/StatusPill";
import { SyncConflictPanel } from "./SyncConflictPanel";
import type { SettingsPanelProps } from "./types";

const localAccount = { mode: "local", configured: false, email: null, message: "尚未配置同步服务；任务只保存在这台设备。" } as const;
const localSync = { phase: "offline", pendingCount: 0, conflicts: [], lastSuccessAt: null, error: null } as const;

export function SettingsPanel({
  theme, reduceMotion, syncState = "synced", account = localAccount, sync = localSync,
  onThemeChange, onReduceMotionChange, onExport, onImport, backupRestoreDisabled = false, backupRestoreHint, onCheckUpdate,
  onSignIn, onSignUp, onSignOut, onSyncNow, onResolveConflict, onClose,
}: SettingsPanelProps) {
  const importRef = useRef<HTMLInputElement>(null);
  const [authIntent, setAuthIntent] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const cloudStatus = sync.phase === "error" ? "error" : sync.phase === "offline" || sync.phase === "auth-required" ? "offline" : sync.phase === "syncing" || sync.pendingCount ? "pending" : syncState;
  const signInOrUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) return setAuthError("请输入邮箱和密码");
    if (authIntent === "sign-up" && password.length < 8) return setAuthError("密码至少需要 8 个字符");
    const handler = authIntent === "sign-in" ? onSignIn : onSignUp;
    if (!handler) return;
    setSubmitting(true); setAuthError("");
    try { await handler(email, password); setPassword(""); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "操作失败，请稍后重试"); }
    finally { setSubmitting(false); }
  };
  const syncNow = async () => { if (!onSyncNow) return; setSyncing(true); try { await onSyncNow(); } finally { setSyncing(false); } };
  const resolveConflict = async (conflict: (typeof sync.conflicts)[number], choice: "local" | "remote" | "merge") => {
    if (!onResolveConflict) return;
    setResolvingId(conflict.id); try { await onResolveConflict(conflict, choice); } finally { setResolvingId(null); }
  };
  return (
    <aside className="settings-panel" aria-label="设置">
      <header><div><p className="eyebrow">本设备</p><h2>偏好设置</h2></div><button className="ui-icon-button" onClick={onClose} aria-label="关闭设置"><X size={19} /></button></header>
      <section>
        <h3>外观</h3>
        <div className="theme-choice">
          <button className={theme === "light" ? "is-selected" : ""} onClick={() => onThemeChange?.("light")}><Sun size={17} /><span>白天</span><small>蓝白简约</small></button>
          <button className={theme === "cyber" ? "is-selected" : ""} onClick={() => onThemeChange?.("cyber")}><Moon size={17} /><span>夜晚</span><small>赛博朋克</small></button>
        </div>
        <label className="setting-toggle"><span>减少动态效果<small>降低扫描光与过渡动画</small></span><input type="checkbox" checked={reduceMotion} onChange={(event) => onReduceMotionChange?.(event.target.checked)} /></label>
      </section>
      <section>
        <h3>账号与同步</h3>
        {!account.configured || account.mode === "local" ? <div className="sync-local-note"><Cloud size={18} aria-hidden="true" /><div><strong>本地模式</strong><p>{account.message ?? localAccount.message}</p></div></div>
          : account.mode === "signed-in" ? <div className="account-summary"><span className="account-summary__avatar" aria-hidden="true"><UserRound size={16} /></span><div><strong>{account.email ?? "已登录账号"}</strong><p>该账号的数据会在你的设备之间同步。</p></div><Button size="sm" tone="quiet" onClick={() => void onSignOut?.()}><LogOut size={14} />退出</Button></div>
          : <form className="sync-auth-form" onSubmit={signInOrUp}>
              <div className="sync-auth-form__title"><KeyRound size={17} aria-hidden="true" /><div><strong>{authIntent === "sign-in" ? "登录以同步任务" : "创建同步账号"}</strong><p>{account.message ?? "使用邮箱安全同步到你的设备。"}</p></div></div>
              <label>邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>密码<input type="password" autoComplete={authIntent === "sign-in" ? "current-password" : "new-password"} minLength={authIntent === "sign-up" ? 8 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              {authError && <p className="sync-form-error" role="alert">{authError}</p>}
              <div className="button-group"><Button type="submit" tone="primary" disabled={submitting}><LogIn size={15} />{submitting ? "处理中…" : authIntent === "sign-in" ? "登录" : "注册"}</Button><Button type="button" tone="quiet" onClick={() => { setAuthIntent(authIntent === "sign-in" ? "sign-up" : "sign-in"); setAuthError(""); }}>{authIntent === "sign-in" ? "创建账号" : "已有账号，登录"}</Button></div>
            </form>}
        {account.mode === "signed-in" && <>
          <div className="setting-row"><span>同步状态<small>{sync.error ?? (sync.lastSuccessAt ? `上次完成：${new Date(sync.lastSuccessAt).toLocaleString("zh-CN")}` : "首次同步尚未完成")}</small></span><StatusPill status={cloudStatus} /></div>
          <div className="sync-actions"><Button tone="primary" onClick={() => void syncNow()} disabled={syncing || sync.phase === "syncing"}><RefreshCw size={16} className={syncing || sync.phase === "syncing" ? "is-spinning" : ""} />{syncing || sync.phase === "syncing" ? "正在同步…" : "立即同步"}</Button>{sync.pendingCount > 0 && <span className="sync-pending-count">还有 {sync.pendingCount} 项待同步</span>}</div>
          <SyncConflictPanel conflicts={sync.conflicts} resolvingId={resolvingId} onResolve={(conflict, choice) => void resolveConflict(conflict, choice)} />
        </>}
      </section>
      <section>
        <h3>数据与版本</h3>
        <div className="setting-row"><span>本地数据</span><StatusPill status={syncState} /></div>
        <Button tone="quiet" onClick={onExport}><Download size={16} />导出本地备份</Button>
        <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport?.(file); event.target.value = ""; }} />
        <Button tone="quiet" disabled={backupRestoreDisabled} onClick={() => importRef.current?.click()}><Upload size={16} />从备份恢复</Button>
        {backupRestoreHint && <p className="sync-local-note">{backupRestoreHint}</p>}
        <Button tone="quiet" onClick={onCheckUpdate}><RefreshCw size={16} />检查更新</Button>
      </section>
    </aside>
  );
}
