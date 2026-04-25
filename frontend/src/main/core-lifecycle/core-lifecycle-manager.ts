import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";

import { resolve_core_runtime_paths } from "./core-command-resolver";
import { wait_for_core_health } from "./core-health-check";
import { format_lifecycle_error, write_ts_lifecycle_log } from "./core-lifecycle-log";
import { build_core_api_base_url, allocate_core_api_port } from "./core-port-allocator";
import { force_kill_process_tree, wait_for_process_exit } from "./core-process-terminator";
import { attach_core_process_output } from "./core-process-output";
import type {
  CoreLifecycleManagerOptions,
  CoreLifecycleStartResult,
  CoreLifecycleState,
  CoreProcessExitResult,
  CoreProcessHandle,
} from "./core-lifecycle-types";

const CORE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_CORE_API_BASE_URL";
const CORE_INSTANCE_TOKEN_ENV_NAME = "LINGUAGACHA_CORE_INSTANCE_TOKEN";
const CORE_RICH_CONSOLE_ENV_NAME = "LINGUAGACHA_CORE_RICH_CONSOLE";
const CORE_CONSOLE_WIDTH_ENV_NAME = "LINGUAGACHA_CORE_CONSOLE_WIDTH";
const PARENT_PID_ENV_NAME = "LINGUAGACHA_PARENT_PID";
const CORE_SHUTDOWN_PATH = "/api/lifecycle/shutdown";
const CORE_SHUTDOWN_HTTP_TIMEOUT_MS = 1_000;
const DEFAULT_CORE_CONSOLE_WIDTH = 160;
const WINDOWS_CONSOLE_WIDTH_QUERY_TIMEOUT_MS = 1_000;

function create_instance_token(): string {
  return crypto.randomBytes(24).toString("hex");
}

function create_exit_promise(
  core_process: ReturnType<typeof spawn>,
): Promise<CoreProcessExitResult> {
  return new Promise((resolve) => {
    core_process.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

function normalize_core_console_width(value: number | string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized_value = Number(value);
  if (Number.isFinite(normalized_value) && normalized_value > 0) {
    return Math.floor(normalized_value).toString();
  }

  return null;
}

export function parse_windows_console_columns(output: string): string | null {
  const match = /Columns:\s*(\d+)/i.exec(output);
  return normalize_core_console_width(match?.[1] ?? null);
}

function read_windows_console_width(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const output = execFileSync("cmd.exe", ["/d", "/s", "/c", "mode con"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: WINDOWS_CONSOLE_WIDTH_QUERY_TIMEOUT_MS,
    });
    return parse_windows_console_columns(output);
  } catch {
    return null;
  }
}

export function resolve_core_console_width(
  columns: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
  windows_console_width: string | null = read_windows_console_width(),
): string {
  return (
    normalize_core_console_width(env[CORE_CONSOLE_WIDTH_ENV_NAME]) ??
    normalize_core_console_width(columns) ??
    normalize_core_console_width(env["COLUMNS"]) ??
    normalize_core_console_width(windows_console_width) ??
    DEFAULT_CORE_CONSOLE_WIDTH.toString()
  );
}

export function build_core_process_env(
  base_url: string,
  instance_token: string,
  console_width: string = resolve_core_console_width(process.stdout.columns),
): NodeJS.ProcessEnv {
  const core_process_env: NodeJS.ProcessEnv = {
    ...process.env,
    [CORE_API_BASE_URL_ENV_NAME]: base_url,
    [CORE_INSTANCE_TOKEN_ENV_NAME]: instance_token,
    [CORE_CONSOLE_WIDTH_ENV_NAME]: console_width,
    [CORE_RICH_CONSOLE_ENV_NAME]: "1",
    COLUMNS: console_width,
    CLICOLOR_FORCE: "1",
    FORCE_COLOR: process.env["FORCE_COLOR"] ?? "1",
    [PARENT_PID_ENV_NAME]: process.pid.toString(),
    PYTHONUNBUFFERED: "1",
  };
  delete core_process_env["NO_COLOR"];
  return core_process_env;
}

async function request_core_shutdown(base_url: string, instance_token: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CORE_SHUTDOWN_HTTP_TIMEOUT_MS);

  try {
    await fetch(`${base_url}${CORE_SHUTDOWN_PATH}`, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "X-LinguaGacha-Core-Token": instance_token,
      },
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export class CoreLifecycleManager {
  private state: CoreLifecycleState = "idle";
  private readonly options: CoreLifecycleManagerOptions;
  private handle: CoreProcessHandle | null = null;
  private base_url: string | null = null;
  private instance_token: string | null = null;

  public constructor(options: CoreLifecycleManagerOptions) {
    this.options = options;
  }

  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  public async start(): Promise<CoreLifecycleStartResult> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Core 生命周期状态不允许启动：${this.state}`);
    }

    this.state = "starting";
    const instance_token = create_instance_token();
    const port = await allocate_core_api_port();
    const base_url = build_core_api_base_url(port);
    const console_width = resolve_core_console_width(process.stdout.columns);
    const runtime_paths = resolve_core_runtime_paths({
      appRoot: this.options.appRoot,
      env: process.env,
      isPackaged: this.options.isPackaged,
      platform: process.platform,
      resourcesPath: this.options.resourcesPath,
    });

    write_ts_lifecycle_log(`正在启动 Python Core - ${base_url}`);
    write_ts_lifecycle_log(`源码目录 - ${runtime_paths.coreSourceRoot}`);
    write_ts_lifecycle_log(`uv 路径 - ${runtime_paths.uvCommand}`);
    write_ts_lifecycle_log(`Rich 控制台宽度 - ${console_width}`);

    const core_process = spawn(
      runtime_paths.uvCommand,
      ["--project", runtime_paths.coreSourceRoot, "run", "app.py"],
      {
        cwd: runtime_paths.coreSourceRoot,
        detached: process.platform !== "win32",
        env: build_core_process_env(base_url, instance_token, console_width),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    attach_core_process_output(core_process);
    write_ts_lifecycle_log(`Python Core 进程已启动 - pid=${core_process.pid ?? "unknown"}`);
    const handle = {
      process: core_process,
      exitPromise: create_exit_promise(core_process),
    };

    this.handle = handle;
    this.base_url = base_url;
    this.instance_token = instance_token;

    core_process.once("error", (error) => {
      if (this.state === "starting") {
        this.state = "failed";
      }
      write_ts_lifecycle_log(`Python Core 启动失败 - ${format_lifecycle_error(error)}`);
    });

    void handle.exitPromise.then((result) => {
      const was_unexpected = this.state === "starting" || this.state === "ready";
      if (was_unexpected) {
        this.state = "failed";
        this.options.onUnexpectedExit?.(result);
      }
    });

    try {
      await Promise.race([
        wait_for_core_health(base_url, instance_token),
        handle.exitPromise.then((result) => {
          throw new Error(`Python Core 在健康检查通过前退出，退出码：${result.exitCode ?? "null"}`);
        }),
      ]);
    } catch (error) {
      this.state = "failed";
      await this.stop();
      throw error;
    }

    process.env[CORE_API_BASE_URL_ENV_NAME] = base_url;
    this.state = "ready";
    write_ts_lifecycle_log(`Python Core 已就绪 - ${base_url}`);
    return { baseUrl: base_url, instanceToken: instance_token };
  }

  public async stop(): Promise<void> {
    if (this.handle === null) {
      this.state = "stopped";
      return;
    }

    if (this.state === "stopping") {
      await wait_for_process_exit(this.handle);
      return;
    }

    const current_handle = this.handle;
    const current_base_url = this.base_url;
    const current_instance_token = this.instance_token;
    this.state = "stopping";
    write_ts_lifecycle_log("正在关闭 Python Core");

    if (current_base_url !== null && current_instance_token !== null) {
      try {
        write_ts_lifecycle_log(`请求 Python Core 优雅关闭 - ${current_base_url}`);
        await request_core_shutdown(current_base_url, current_instance_token);
      } catch (error) {
        write_ts_lifecycle_log(`请求 Python Core 优雅关闭失败 - ${format_lifecycle_error(error)}`);
      }
    }

    const exited = await wait_for_process_exit(current_handle);
    if (!exited && current_handle.process.pid !== undefined) {
      write_ts_lifecycle_log(
        `Python Core 未按时退出，准备强制清理进程树 - pid=${current_handle.process.pid.toString()}`,
      );
      await force_kill_process_tree(current_handle.process.pid, process.platform);
      await wait_for_process_exit(current_handle);
    }

    this.handle = null;
    this.base_url = null;
    this.instance_token = null;
    this.state = "stopped";
    write_ts_lifecycle_log("Python Core 已关闭");
  }
}
