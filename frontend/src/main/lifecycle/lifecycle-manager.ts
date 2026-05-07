import { spawn } from "node:child_process";
import crypto from "node:crypto";

import { resolve_core_launch_command } from "./lifecycle-command-resolver";
import { wait_for_core_health } from "./lifecycle-health-check";
import {
  format_core_shutdown_completed_log,
  format_lifecycle_error,
  write_ts_lifecycle_log,
} from "./lifecycle-log";
import { build_core_api_base_url, allocate_core_api_port } from "./lifecycle-port-allocator";
import { force_kill_process_tree, wait_for_process_exit } from "./lifecycle-process-terminator";
import { attach_core_process_output } from "./lifecycle-process-output";
import { DatabaseServer } from "../database/database-server";
import type {
  CoreLaunchCommand,
  CoreLifecycleManagerOptions,
  CoreLifecycleStartResult,
  CoreLifecycleState,
  CoreProcessExitResult,
  CoreProcessHandle,
} from "./lifecycle-types";

const CORE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_CORE_API_BASE_URL";
const CORE_API_TOKEN_ENV_NAME = "LINGUAGACHA_CORE_API_TOKEN";
const DATABASE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_DATABASE_API_BASE_URL";
const DATABASE_API_TOKEN_ENV_NAME = "LINGUAGACHA_DATABASE_API_TOKEN";
const PARENT_PID_ENV_NAME = "LINGUAGACHA_PARENT_PID";
const CORE_SHUTDOWN_PATH = "/api/lifecycle/shutdown";
const CORE_SHUTDOWN_HTTP_TIMEOUT_MS = 1_000;

export interface CoreProcessSpawnRequest {
  command: string;
  args: string[];
  options: {
    cwd: string;
    detached: boolean;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
    windowsHide: boolean;
  };
}

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

export function build_core_process_env(
  base_url: string,
  instance_token: string,
  database_base_url?: string,
  database_token?: string,
): NodeJS.ProcessEnv {
  // Core 只能通过环境变量获知本机协议入口，renderer 不参与后端地址传递。
  const core_process_env: NodeJS.ProcessEnv = {
    ...process.env,
    [CORE_API_BASE_URL_ENV_NAME]: base_url,
    [CORE_API_TOKEN_ENV_NAME]: instance_token,
    [PARENT_PID_ENV_NAME]: process.pid.toString(),
    PYTHONUNBUFFERED: "1",
  };
  if (database_base_url !== undefined && database_token !== undefined) {
    core_process_env[DATABASE_API_BASE_URL_ENV_NAME] = database_base_url;
    core_process_env[DATABASE_API_TOKEN_ENV_NAME] = database_token;
  }
  return core_process_env;
}

export function build_core_process_spawn_request(
  launch_command: CoreLaunchCommand,
  base_url: string,
  instance_token: string,
  database_base_url?: string,
  database_token?: string,
  platform: NodeJS.Platform = process.platform,
): CoreProcessSpawnRequest {
  return {
    command: launch_command.command,
    args: launch_command.args,
    options: {
      cwd: launch_command.cwd,
      detached: platform !== "win32",
      env: build_core_process_env(base_url, instance_token, database_base_url, database_token),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  };
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

// Electron main 持有 Core 与内部 Database Service 的启动、关闭和故障回收顺序。
export class CoreLifecycleManager {
  private state: CoreLifecycleState = "idle";
  private readonly options: CoreLifecycleManagerOptions;
  private handle: CoreProcessHandle | null = null;
  private base_url: string | null = null;
  private instance_token: string | null = null;
  private readonly database_server = new DatabaseServer();

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
    const launch_command = resolve_core_launch_command({
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    });
    // Database 必须先于 Core 启动，Core 启动后会立即按 env 创建 DatabaseGateway。
    const database_start_result = await this.database_server.start();
    let has_logged_start_failure = false;

    write_ts_lifecycle_log(`Database Service 已启动 - ${database_start_result.baseUrl}`);
    write_ts_lifecycle_log("Python Core 正在启动 …");

    const spawn_request = build_core_process_spawn_request(
      launch_command,
      base_url,
      instance_token,
      database_start_result.baseUrl,
      database_start_result.token,
    );
    const core_process = spawn(spawn_request.command, spawn_request.args, spawn_request.options);
    attach_core_process_output(core_process);
    if (core_process.pid !== undefined) {
      write_ts_lifecycle_log(`Python Core PID[${core_process.pid}] 实例已启动 - ${base_url}`);
    }
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
      has_logged_start_failure = true;
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
      if (!has_logged_start_failure) {
        write_ts_lifecycle_log(`Python Core 启动失败 - ${format_lifecycle_error(error)}`);
      }
      this.state = "failed";
      await this.stop_core(false);
      await this.database_server.stop();
      throw error;
    }

    process.env[CORE_API_BASE_URL_ENV_NAME] = base_url;
    process.env[DATABASE_API_BASE_URL_ENV_NAME] = database_start_result.baseUrl;
    this.state = "ready";
    return { baseUrl: base_url, instanceToken: instance_token };
  }

  public async stop(): Promise<void> {
    await this.stop_core(true);
  }

  private async stop_core(should_log_lifecycle: boolean): Promise<void> {
    if (this.handle === null) {
      await this.database_server.stop();
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
    const current_pid = current_handle.process.pid;
    this.state = "stopping";
    if (should_log_lifecycle) {
      write_ts_lifecycle_log("Python Core 正在关闭 …");
    }

    let was_force_killed = false;

    if (current_base_url !== null && current_instance_token !== null) {
      try {
        await request_core_shutdown(current_base_url, current_instance_token);
      } catch {
        // 关闭结果由最终日志统一呈现，避免终端在正常退出路径中堆叠中间状态。
      }
    }

    // 先等 Core 退出，再关闭 Database，避免 Core 收尾阶段仍在提交工程事实。
    const exited = await wait_for_process_exit(current_handle);
    if (!exited && current_handle.process.pid !== undefined) {
      was_force_killed = true;
      await force_kill_process_tree(current_handle.process.pid, process.platform);
      await wait_for_process_exit(current_handle);
    }

    this.handle = null;
    this.base_url = null;
    this.instance_token = null;
    await this.database_server.stop();
    this.state = "stopped";
    if (should_log_lifecycle) {
      write_ts_lifecycle_log(format_core_shutdown_completed_log(current_pid, was_force_killed));
    }
  }
}
