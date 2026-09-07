import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { build } from "vite";
import { expect, it } from "vitest";

import { AGENT_WORKSPACE_CONTRACT } from "../../src/backend/agent/workspace/contract.ts";
import { DenoAgentWorkspaceRunner } from "../../src/backend/agent/workspace/runtime/runner.ts";
import { project_path } from "./project-paths.ts";

it("单文件构建产物由 Deno 加载 TypeScript 并保留语法诊断", async () => {
  const temporary_root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-deno-runtime-")); // 隔离产物与工作区，统一清理
  try {
    const workspace_path = path.join(temporary_root, "workspace");
    const bundle_path = path.join(temporary_root, "bundle");
    await mkdir(workspace_path);
    await writeFile(
      path.join(workspace_path, "contract.json"),
      JSON.stringify(AGENT_WORKSPACE_CONTRACT),
    );
    // 使用生产配置构建到隔离目录，覆盖打包转换与 Deno 模块加载之间的真实边界。
    await build({
      configFile: project_path("buildtools/vite/deno-runtime.vite.config.ts"),
      logLevel: "silent",
      build: { outDir: bundle_path },
    });
    expect(await readdir(bundle_path)).toEqual(["deno-runtime.js"]);
    const runner = new DenoAgentWorkspaceRunner({
      executablePath: project_path(
        "resources",
        "deno",
        process.platform === "win32" ? "deno.exe" : "deno",
      ),
      runtimeEntryPath: path.join(bundle_path, "deno-runtime.js"),
      systemProxyResolver: { resolveProxy: async () => "DIRECT" },
    });
    await runner.initialize();
    const signal = AbortSignal.timeout(10_000); // 子进程超时先回收，再清理临时目录
    await expect(
      runner.run(
        {
          workspacePath: workspace_path,
          script: "const value: number = await Promise.resolve(42); return value;",
          todos: [],
        },
        signal,
      ),
    ).resolves.toMatchObject({ result: 42 });
    await expect(
      runner.run(
        {
          workspacePath: workspace_path,
          script: "for (const value of [1]) { if (value continue; } return null;",
          todos: [],
        },
        signal,
      ),
    ).rejects.toThrow(/Expected '\)', got 'continue'/u);
  } finally {
    await rm(temporary_root, { recursive: true, force: true });
  }
}, 30_000);
