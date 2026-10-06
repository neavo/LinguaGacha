import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { createPackageWithOptions } from "@electron/asar";
import { loadConfigFromFile, MainConfigFactory } from "electron-vite";
import { build } from "vite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendWorkerExecution } from "./backend/worker/worker-execution";

const original_argv = process.argv; // 入口测试改写参数后恢复进程状态。
const original_exit_code = process.exitCode; // 恢复 CLI 分支可能写入的退出状态。
const original_exec_path_descriptor = Object.getOwnPropertyDescriptor(process, "execPath"); // 恢复模拟安装位置前的属性描述。
let exit_codes: Array<string | number | null | undefined> = []; // 记录 CLI 分支请求的进程退出码

type CLIEntryCall = {
  appRoot: string;
  argv: string[];
  workerExecution: BackendWorkerExecution;
};

type GuiEntryCall = {
  desktopBundleDir: string;
  backendRuntimeWorkerEntryUrl: URL;
};

beforeEach(() => {
  vi.resetModules();
  exit_codes = [];
  vi.spyOn(process, "exit").mockImplementation((code) => {
    exit_codes.push(code);
    return undefined as never;
  });
});

afterEach(() => {
  process.argv = original_argv;
  process.exitCode = original_exit_code;
  if (original_exec_path_descriptor !== undefined) {
    Object.defineProperty(process, "execPath", original_exec_path_descriptor);
  }
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("产品统一入口", () => {
  it("发布态 app.exe 使用 --cli 后的命令参数并以可执行文件目录作为 appRoot", async () => {
    using temp_root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-entry-"));
    const app_root = temp_root.path;
    const calls = mock_entry_modules();
    const executable_path = path.join(app_root, "app.exe");
    fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3", "utf-8");
    set_process_args(executable_path, [executable_path, "--cli", "translate", "--help"]);

    await import("./index");
    await wait_for_entry(() => calls.cli.length === 1);

    expect(calls.cli).toHaveLength(1);
    expect(calls.cli[0]).toMatchObject({
      argv: ["translate", "--help"],
      appRoot: app_root,
    });
    expect_worker_threads_backend_worker_execution(calls.cli[0]?.workerExecution);
    expect(calls.gui).toEqual([]);
    expect(exit_codes).toEqual([0]);
  });

  it("开发态 --cli 只把标记后的参数交给 CLI parser", async () => {
    const calls = mock_entry_modules();
    const executable_path = path.join(process.cwd(), "node_modules", "electron.exe");
    set_process_args(executable_path, [
      executable_path,
      process.cwd(),
      "--cli",
      "analyze",
      "--help",
    ]);

    await import("./index");
    await wait_for_entry(() => calls.cli.length === 1);

    expect(calls.cli).toHaveLength(1);
    expect(calls.cli[0]).toMatchObject({
      argv: ["analyze", "--help"],
      appRoot: process.cwd(),
    });
    expect_worker_threads_backend_worker_execution(calls.cli[0]?.workerExecution);
    expect(calls.gui).toEqual([]);
    expect(exit_codes).toEqual([0]);
  });

  it("可执行文件名为 cli.exe 但没有 --cli 时仍进入 GUI 入口", async () => {
    const calls = mock_entry_modules();
    const executable_path = path.join(process.cwd(), "cli.exe");
    set_process_args(executable_path, [executable_path]);

    await import("./index");
    await wait_for_entry(() => calls.gui.length === 1);

    expect(calls.cli).toEqual([]);
    expect(calls.gui[0]).toMatchObject({
      desktopBundleDir: expect.any(String),
    });
    expect(String(calls.gui[0]?.backendRuntimeWorkerEntryUrl)).toMatch(
      /\/backend-runtime-worker-entry\.js$/u,
    );
    expect(exit_codes).toEqual([]);
  });
});

/**
 * 替换 GUI 与 CLI 入口模块，测试只观察产品入口分发结果。
 */
function mock_entry_modules(): {
  cli: CLIEntryCall[];
  gui: GuiEntryCall[];
} {
  const calls = {
    cli: [] as CLIEntryCall[],
    gui: [] as GuiEntryCall[],
  };
  vi.doMock("./cli/cli-entry", () => {
    return {
      run_cli_entry: async (
        argv: string[],
        appRoot: string,
        workerExecution: BackendWorkerExecution,
      ) => {
        calls.cli.push({ argv, appRoot, workerExecution });
        return 0;
      },
    };
  });
  vi.doMock("./gui/gui-entry", () => {
    return {
      run_gui_entry: (options: GuiEntryCall) => {
        calls.gui.push(options);
      },
    };
  });
  return calls;
}

/**
 * 重写进程启动参数，模拟发布态 app.exe 和开发态 electron.exe。
 */
function set_process_args(executable_path: string, argv: string[]): void {
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: executable_path,
  });
  process.argv = argv;
}

/**
 * 断言产品入口把 Backend worker 执行配置固定为 worker_threads，并指向约定 worker 产物。
 */
function expect_worker_threads_backend_worker_execution(
  worker_execution: BackendWorkerExecution | undefined,
): void {
  expect(worker_execution?.kind).toBe("worker_threads");
  if (worker_execution?.kind !== "worker_threads") {
    return;
  }
  expect(String(worker_execution.workUnitWorkerEntryUrl)).toMatch(/\/work-unit-worker-entry\.js$/u);
}

/**
 * 等待顶层异步入口完成动态 import 和 mock 调用。
 */
async function wait_for_entry(is_ready: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(is_ready()).toBe(true);
  });
}

// 探针与产品入口共用 SDK chunk，观察合并构建的独立执行能力。
it("仓库外 ASAR 独立启动 CLI，并通过合并后的 SDK 读取成功响应", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lg-release-dependencies-"));
  try {
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      "buildtools/vite/electron.vite.config.ts",
    );
    const main = loaded.config.main;
    const source = path.join(root, "应用 # 空格");
    const bundle = path.join(source, "build/dist-electron");
    const config = await new MainConfigFactory(
      {
        ...main,
        build: {
          ...main?.build,
          outDir: bundle,
          rolldownOptions: {
            ...main?.build?.rolldownOptions,
            input: {
              ...(main?.build?.rolldownOptions?.input as Record<string, string>), // 产品配置使用具名入口，Vite 类型也允许数组。
              "release-probe": path.resolve("src/test/entry-build-probe.mjs"),
            },
          },
        },
      },
      { logLevel: "silent" },
      {},
    ).build();
    await build(config);
    await writeFile(path.join(source, "package.json"), JSON.stringify({ type: "module" }));
    const archive = path.join(root, "app.asar");
    await createPackageWithOptions(source, archive, {});
    const packaged_bundle = path.join(archive, "build/dist-electron"); // Electron 从 ASAR 虚拟目录加载入口。
    const electron_path = createRequire(import.meta.url)("electron") as string; // Node 侧包导出可执行文件路径。
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = promisify(execFile);
    const cli = await run(
      electron_path,
      [path.join(packaged_bundle, "index.js"), "--cli", "--help"],
      {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 20_000,
      },
    );
    assert.match(cli.stdout, /--help/);
    // 探针中的断言失败会使子进程以非零状态退出。
    await run(electron_path, [path.join(packaged_bundle, "release-probe.js")], {
      cwd: root,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      timeout: 20_000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
