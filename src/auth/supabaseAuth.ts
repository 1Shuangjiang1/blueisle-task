import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthGateway, AuthSession } from "../sync/types";

export type AccountMode = "local" | "signed-out" | "signed-in" | "loading" | "error";

export interface AccountState {
  readonly mode: AccountMode;
  readonly configured: boolean;
  /** Stable identity from the auth event, used to isolate workspaces immediately. */
  readonly userId?: string | null;
  readonly email: string | null;
  readonly message: string | null;
}

export interface EmailPasswordAuthService extends AuthGateway {
  getState(): AccountState;
  subscribe(listener: (state: AccountState) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
  dispose(): void;
}

export interface SupabaseAuthEnvironment {
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase has renamed anon keys to publishable keys. Accept either during migration. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

export function configuredValues(environment: SupabaseAuthEnvironment): { url: string; key: string } | null {
  const url = environment.VITE_SUPABASE_URL?.trim();
  const key = (environment.VITE_SUPABASE_PUBLISHABLE_KEY ?? environment.VITE_SUPABASE_ANON_KEY)?.trim();
  return url && key ? { url, key } : null;
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session?.access_token || !session.user?.id) return null;
  return { userId: session.user.id, accessToken: session.access_token };
}

function toAccountState(session: Session | null): AccountState {
  return session?.user
    ? {
        mode: "signed-in",
        configured: true,
        userId: session.user.id,
        email: session.user.email ?? null,
        message: null,
      }
    : { mode: "signed-out", configured: true, userId: null, email: null, message: null };
}

class LocalOnlyAuthService implements EmailPasswordAuthService {
  private readonly state: AccountState = {
    mode: "local",
    configured: false,
    userId: null,
    email: null,
    message: "尚未配置同步服务；任务只保存在这台设备。",
  };

  getState(): AccountState { return this.state; }
  subscribe(listener: (state: AccountState) => void): () => void { listener(this.state); return () => undefined; }
  async getSession(): Promise<AuthSession | null> { return null; }
  async refreshSession(): Promise<AuthSession | null> { return null; }
  async signIn(): Promise<void> { throw new Error("请先配置同步服务"); }
  async signUp(): Promise<{ needsEmailConfirmation: boolean }> { throw new Error("请先配置同步服务"); }
  async signOut(): Promise<void> { return; }
  dispose(): void { /* no subscription in local-only mode */ }
}

class SupabaseEmailPasswordAuthService implements EmailPasswordAuthService {
  private state: AccountState = {
    mode: "loading",
    configured: true,
    userId: null,
    email: null,
    message: null,
  };
  private readonly listeners = new Set<(state: AccountState) => void>();
  private readonly subscription;
  private authRevision = 0;

  constructor(private readonly client: SupabaseClient) {
    this.subscription = client.auth.onAuthStateChange((_event, session) => {
      this.authRevision += 1;
      this.setState(toAccountState(session));
    }).data.subscription;
    void this.loadInitialSession();
  }

  getState(): AccountState { return this.state; }
  subscribe(listener: (state: AccountState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return toAuthSession(data.session);
  }
  async refreshSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error) throw error;
    return toAuthSession(data.session);
  }
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      this.setState({ mode: "error", configured: true, userId: null, email: null, message: error.message });
      throw error;
    }
  }
  async signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password });
    if (error) {
      this.setState({ mode: "error", configured: true, userId: null, email: null, message: error.message });
      throw error;
    }
    const needsEmailConfirmation = !data.session;
    if (needsEmailConfirmation) {
      this.setState({ mode: "signed-out", configured: true, userId: null, email: email.trim(), message: "验证邮件已发送，请完成验证后登录。" });
    }
    return { needsEmailConfirmation };
  }
  async signOut(): Promise<void> {
    // A personal device logout must not revoke the other Windows/Android
    // sessions that are expected to keep syncing independently.
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
  dispose(): void { this.subscription.unsubscribe(); this.listeners.clear(); }

  private async loadInitialSession(): Promise<void> {
    const revision = this.authRevision;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      if (revision !== this.authRevision) return;
      this.setState(toAccountState(data.session));
    } catch (error) {
      if (revision !== this.authRevision) return;
      this.setState({ mode: "error", configured: true, userId: null, email: null, message: error instanceof Error ? error.message : "无法读取登录状态" });
    }
  }
  private setState(state: AccountState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}

/**
 * Creates no cloud client until both public configuration values exist. This
 * keeps an unconfigured install entirely local and avoids accidental requests.
 */
export function createEmailPasswordAuthService(
  environment: SupabaseAuthEnvironment = import.meta.env as SupabaseAuthEnvironment,
  client?: SupabaseClient,
): EmailPasswordAuthService {
  const values = configuredValues(environment);
  if (!values) return new LocalOnlyAuthService();
  return new SupabaseEmailPasswordAuthService(client ?? createClient(values.url, values.key));
}

export interface SupabaseRuntime {
  readonly auth: EmailPasswordAuthService;
  readonly client: SupabaseClient | null;
}

/** Creates one shared client for Auth and sync so only one GoTrue session owner exists. */
export function createSupabaseRuntime(
  environment: SupabaseAuthEnvironment = import.meta.env as SupabaseAuthEnvironment,
): SupabaseRuntime {
  const values = configuredValues(environment);
  if (!values) return { auth: createEmailPasswordAuthService(environment), client: null };
  const client = createClient(values.url, values.key);
  return { auth: createEmailPasswordAuthService(environment, client), client };
}
