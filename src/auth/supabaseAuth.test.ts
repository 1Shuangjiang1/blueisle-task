import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createEmailPasswordAuthService } from "./supabaseAuth";

describe("createEmailPasswordAuthService", () => {
  it("keeps an unconfigured installation in local-only mode", async () => {
    const service = createEmailPasswordAuthService({});
    expect(service.getState()).toMatchObject({ mode: "local", configured: false });
    expect(await service.getSession()).toBeNull();
    await expect(service.signIn("person@example.com", "not-used")).rejects.toThrow("请先配置同步服务");
  });
});

describe("configured auth", () => {
  it("publishes the auth user id and signs out only this device", async () => {
    let authListener: ((event: string, session: Session | null) => void) | undefined;
    const signOut = vi.fn(async () => ({ error: null }));
    const client = {
      auth: {
        onAuthStateChange: vi.fn((listener: (event: string, session: Session | null) => void) => {
          authListener = listener;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        signOut,
      },
    } as unknown as SupabaseClient;
    const service = createEmailPasswordAuthService(
      { VITE_SUPABASE_URL: "https://example.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-key" },
      client,
    );
    const states: ReturnType<typeof service.getState>[] = [];
    const unsubscribe = service.subscribe((state) => states.push(state));

    authListener?.("SIGNED_IN", {
      access_token: "access",
      user: { id: "user-a", email: "person@example.com" },
    } as Session);
    await service.signOut();

    expect(states.at(-1)).toMatchObject({
      mode: "signed-in",
      userId: "user-a",
      email: "person@example.com",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    unsubscribe();
    service.dispose();
  });
});
