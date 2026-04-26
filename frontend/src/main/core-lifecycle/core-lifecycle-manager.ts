import { spawn } from "node:child_process";
import crypto from "node:crypto";

import { resolve_core_launch_command } from "./core-command-resolver";
import { wait_for_core_health } from "./core-health-check";
import {
  format_core_shutdown_completed_log,
  format_lifecycle_error,
  write_ts_lifecycle_log,
} from "./core-lifecycle-log";
import { build_core_api_base_url, allocate_core_api_port } from "./core-port-allocator";
import { force_kill_process_tree, wait_for_process_exit } from "./core-process-terminator";
import { attach_core_process_output } from "./core-process-output";
import type {
  CoreLaunchCommand,
  CoreLifecycleManagerOptions,
  CoreLifecycleStartResult,
  CoreLifecycleState,
  CoreProcessExitResult,
  CoreProcessHandle,
} from "./core-lifecycle-types";

const CORE_API_BASE_URL_ENV_NAME = "LINGUAGACHA_CORE_API_BASE_URL";
const CORE_INSTANCE_TOKEN_ENV_NAME = "LINGUAGACHA_CORE_INSTANCE_TOKEN";
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
): NodeJS.ProcessEnv {
  const core_process_env: NodeJS.ProcessEnv = {
    ...process.env,
    [CORE_API_BASE_URL_ENV_NAME]: base_url,
    [CORE_INSTANCE_TOKEN_ENV_NAME]: instance_token,
    [PARENT_PID_ENV_NAME]: process.pid.toString(),
    PYTHONUNBUFFERED: "1",
  };
  return core_process_env;
}

export function build_core_process_spawn_request(
  launch_command: CoreLaunchCommand,
  base_url: string,
  instance_token: string,
  platform: NodeJS.Platform = process.platform,
): CoreProcessSpawnRequest {
  return {
    command: launch_command.command,
    args: launch_command.args,
    options: {
      cwd: launch_command.cwd,
      detached: platform !== "win32",
      env: build_core_process_env(base_url, instance_token),
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
    const launch_command = resolve_core_launch_command({
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    });
    let has_logged_start_failure = false;

    write_ts_lifecycle_log("Python Core 正在启动 …");

    const spawn_request = build_core_process_spawn_request(
      launch_command,
      base_url,
      instance_token,
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
      throw error;
    }

    process.env[CORE_API_BASE_URL_ENV_NAME] = base_url;
    this.state = "ready";
    return { baseUrl: base_url, instanceToken: instance_token };
  }

  public async stop(): Promise<void> {
    await this.stop_core(true);
  }

  private async stop_core(should_log_lifecycle: boolean): Promise<void> {
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

    const exited = await wait_for_process_exit(current_handle);
    if (!exited && current_handle.process.pid !== undefined) {
      was_force_killed = true;
      await force_kill_process_tree(current_handle.process.pid, process.platform);
      await wait_for_process_exit(current_handle);
    }

    this.handle = null;
    this.base_url = null;
    this.instance_token = null;
    this.state = "stopped";
    if (should_log_lifecycle) {
      write_ts_lifecycle_log(format_core_shutdown_completed_log(current_pid, was_force_killed));
    }
  }
}
