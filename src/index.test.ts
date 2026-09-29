import fs from "node:fs";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { createPackageWithOptions } from "@electron/asar";
import { build } from "vite";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendWorkerExecution } from "./backend/worker/worker-execution";

const original_argv = process.argv;
const original_exit_code = process.exitCode;
const original_exec_path_descriptor = Object.getOwnPropertyDescriptor(process, "execPath");
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

describe("打包入口原生工具初始化", () => {
  const require = createRequire(import.meta.url);
  const electron_path = require("electron") as string;
  let root = "";
  let archive = "";

  // 只替换 GUI/CLI 业务，运行真实产品入口，验证动态导入前的初始化和 worker 继承。
  const probe = `
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
/** 执行转换后的程序，并观察 worker 是否继承产品入口配置的二进制路径。 */
async function verify() {
  const code = esbuild.transformSync('const value: number = 1;', { loader: 'ts' }).code;
  const worker = new Worker(\`
    const { parentPort, workerData } = require('node:worker_threads');
    const esbuild = require(workerData);
    const code = esbuild.transformSync('const value: number = 2;', { loader: 'ts' }).code;
    parentPort.postMessage({ binary: process.env.ESBUILD_BINARY_PATH,
      value: require('node:vm').runInNewContext(code + ';value') });
    esbuild.stop();
  \`, { eval: true, workerData: require.resolve('esbuild') });
  const exited = once(worker, 'exit');
  const [result] = await once(worker, 'message');
  await exited;
  esbuild.stop();
  console.log(JSON.stringify({ binary: process.env.ESBUILD_BINARY_PATH,
    value: runInNewContext(code + ';value'), worker: result }));
  return 0;
}
export { verify as run_cli_entry, verify as run_gui_entry };
`;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "linguagacha-esbuild-"));
    const source = path.join(root, "应用 # 空格");
    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "entry-business-probe",
          enforce: "pre",
          /** 只替换分发后的业务入口，产品初始化和 SDK 加载使用真实代码。 */
          resolveId(id) {
            if (id === "./cli/cli-entry" || id === "./gui/gui-entry")
              return "\0entry-business-probe";
          },
          /** 两条入口复用同一段转换与线程继承验证。 */
          load(id) {
            if (id === "\0entry-business-probe") return probe;
          },
        },
      ],
      build: {
        outDir: path.join(source, "build/dist-electron"),
        lib: { entry: path.resolve("src/index.ts"), formats: ["es"], fileName: () => "index.js" },
        rolldownOptions: { external: [/^node:/u], platform: "node" },
        minify: false,
      },
    });
    await writeFile(path.join(source, "package.json"), JSON.stringify({ type: "module" }));
    const pi_require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
    const esbuild_manifest = pi_require.resolve("esbuild/package.json");
    const esbuild_require = createRequire(esbuild_manifest);
    const platform_package = `@esbuild/${process.platform}-${process.arch}`;
    await cp(path.dirname(esbuild_manifest), path.join(source, "node_modules/esbuild"), {
      recursive: true,
    });
    await cp(
      path.dirname(esbuild_require.resolve(`${platform_package}/package.json`)),
      path.join(source, "node_modules", platform_package),
      { recursive: true },
    );
    const resources = path.join(root, "发行 # 空格", "resources");
    await mkdir(resources, { recursive: true });
    archive = path.join(resources, "app.asar");
    await createPackageWithOptions(source, archive, { unpack: "**/@esbuild/**" });
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it.each([
    { mode: "GUI", args: [] },
    { mode: "CLI", args: ["--cli"] },
  ])("产品入口 $mode 在加载 SDK 前初始化，并让 worker 执行真实 esbuild", async ({ args }) => {
    const { stdout } = await promisify(execFile)(
      electron_path,
      [path.join(archive, "build/dist-electron/index.js"), ...args],
      {
        cwd: root,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          ESBUILD_BINARY_PATH: "stale-installation",
        },
        windowsHide: true,
        timeout: 15_000,
      },
    );
    const result = JSON.parse(stdout) as {
      binary: string;
      value: number;
      worker: { binary: string; value: number };
    };
    expect(result.value).toBe(1);
    expect(result.worker).toEqual({ binary: result.binary, value: 2 });
  });
});
