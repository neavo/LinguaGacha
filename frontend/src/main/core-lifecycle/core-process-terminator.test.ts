import { describe, expect, it } from "vitest";

import { wait_for_process_exit } from "./core-process-terminator";
import type { CoreProcessHandle } from "./core-lifecycle-types";

describe("wait_for_process_exit", () => {
  it("进程退出时返回 true", async () => {
    const handle = {
      process: {} as CoreProcessHandle["process"],
      exitPromise: Promise.resolve({ exitCode: 0, signal: null }),
    };

    await expect(wait_for_process_exit(handle, 100)).resolves.toBe(true);
  });

  it("等待超时时返回 false", async () => {
    const handle = {
      process: {} as CoreProcessHandle["process"],
      exitPromise: new Promise<never>(() => {}),
    };

    await expect(wait_for_process_exit(handle, 1)).resolves.toBe(false);
  });
});
