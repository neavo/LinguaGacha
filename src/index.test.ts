import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkerExecution } from "./core/worker/worker-execution";

const original_argv = process.argv;
const original_exit_code = process.exitCode;
const original_exec_path_descriptor = Object.getOwnPropertyDescriptor(process, "execPath");
let exit_codes: Array<string | number | null | undefined> = []; // exit_codes 记录 CLI 分支请求的进程退出码

type CLIEntryCall = {
  appRoot: string;
  argv: string[];
  workerExecution: CoreWorkerExecution;
};

type GuiEntryCall = {
  desktopBundleDir: string;
  workerExecution: CoreWorkerExecution;
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
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-entry-"));
    const calls = mock_entry_modules();
    try {
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
      expect_worker_threads_core_worker_execution(calls.cli[0]?.workerExecution);
      expect(calls.gui).toEqual([]);
      expect(exit_codes).toEqual([0]);
    } finally {
      fs.rmSync(app_root, { force: true, recursive: true });
    }
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
    expect_worker_threads_core_worker_execution(calls.cli[0]?.workerExecution);
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
    expect_worker_threads_core_worker_execution(calls.gui[0]?.workerExecution);
    expect(exit_codes).toEqual([]);
  });

  it("普通 app 可执行文件进入 GUI 入口", async () => {
    const calls = mock_entry_modules();
    const executable_path = path.join(process.cwd(), "app.exe");
    set_process_args(executable_path, [executable_path]);

    await import("./index");
    await wait_for_entry(() => calls.gui.length === 1);

    expect(calls.cli).toEqual([]);
    expect(calls.gui[0]).toMatchObject({
      desktopBundleDir: expect.any(String),
    });
    expect_worker_threads_core_worker_execution(calls.gui[0]?.workerExecution);
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
        workerExecution: CoreWorkerExecution,
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
 * 断言产品入口把 Core worker 执行配置固定为 worker_threads，并指向约定 worker 产物。
 */
function expect_worker_threads_core_worker_execution(
  worker_execution: CoreWorkerExecution | undefined,
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
  for (let index = 0; index < 20; index += 1) {
    if (is_ready()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}
