import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { resolve_workspace_runtime_entry } from "./workspace-runtime";

it("私有启动入口从独立运行目录定位，缺失时报告应用安装损坏", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lg-runtime-entries-"));
  try {
    await mkdir(path.join(directory, "runtime"));
    for (const entry of ["bootstrap", "prepare", "pdf-worker"] as const) {
      const file = path.join(directory, "runtime", `${entry}.mjs`);
      await writeFile(file, "throw new Error('入口只能由执行进程加载');");
      expect(resolve_workspace_runtime_entry(directory, entry)).toBe(file);
    }
    await rm(path.join(directory, "runtime/bootstrap.mjs"));
    expect(() => resolve_workspace_runtime_entry(directory, "bootstrap")).toThrowError(
      expect.objectContaining({ cause: expect.objectContaining({ code: "ENOENT" }) }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
