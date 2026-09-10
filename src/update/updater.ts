import { isTauri } from "@tauri-apps/api/core";

export type UpdateResult =
  | { status: "unsupported" }
  | { status: "current" }
  | { status: "available"; version: string; install: () => Promise<void> };

export async function checkForUpdate(): Promise<UpdateResult> {
  if (!isTauri()) return { status: "unsupported" };

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return { status: "current" };

  return {
    status: "available",
    version: update.version,
    install: async () => {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
