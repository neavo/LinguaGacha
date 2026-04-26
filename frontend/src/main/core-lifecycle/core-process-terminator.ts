import { spawn } from "node:child_process";

import type { CoreProcessHandle } from "./core-lifecycle-types";

const CORE_PROCESS_EXIT_TIMEOUT_MS = 5_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function wait_for_process_exit(
  handle: CoreProcessHandle,
  timeout_ms: number = CORE_PROCESS_EXIT_TIMEOUT_MS,
): Promise<boolean> {
  return Promise.race([handle.exitPromise.then(() => true), delay(timeout_ms).then(() => false)]);
}

export async function force_kill_process_tree(
  pid: number,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") {
    await new Promise<void>((resolve) => {
      const taskkill = spawn("taskkill", ["/PID", pid.toString(), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("close", () => {
        resolve();
      });
      taskkill.once("error", () => {
        resolve();
      });
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
}
