import { spawn } from "node:child_process";
import crypto from "node:crypto";

import { resolve_core_app_root, resolve_core_launch_command } from "./lifecycle-command-resolver";
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
import { ApiGatewayServer } from "../api/api-gateway-server";
import { AppPathService } from "../paths/app-path-service";
import { LogManager } from "../log/log-manager";
import { set_electron_main_log_manager } from "../log/log-bridge";
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
const LOG_API_BASE_URL_ENV_NAME = "LINGUAGACHA_LOG_API_BASE_URL";
const LOG_API_TOKEN_ENV_NAME = "LINGUAGACHA_LOG_API_TOKEN";
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
  log_base_url?: string,
  log_token?: string,
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
  if (log_base_url !== undefined && log_token !== undefined) {
    core_process_env[LOG_API_BASE_URL_ENV_NAME] = log_base_url;
    core_process_env[LOG_API_TOKEN_ENV_NAME] = log_token;
  }
  return core_process_env;
}

export function build_core_process_spawn_request(
  launch_command: CoreLaunchCommand,
  base_url: string,
  instance_token: string,
  database_base_url?: string,
  database_token?: string,
  log_base_url?: string,
  log_token?: string,
  platform: NodeJS.Platform = process.platform,
): CoreProcessSpawnRequest {
  return {
    command: launch_command.command,
    args: launch_command.args,
    options: {
      cwd: launch_command.cwd,
      detached: platform !== "win32",
      env: build_core_process_env(
        base_url,
        instance_token,
        database_base_url,
        database_token,
        log_base_url,
        log_token,
      ),
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

/**
 * Electron main 持有 Core 与内部 Database Service 的启动、关闭和故障回收顺序。
 */
export class CoreLifecycleManager {
  private state: CoreLifecycleState = "idle";
  private readonly options: CoreLifecycleManagerOptions;
  private handle: CoreProcessHandle | null = null;
  private py_core_base_url: string | null = null;
  private py_core_instance_token: string | null = null;
  private gateway_server: ApiGatewayServer | null = null;
  private readonly database_server = new DatabaseServer();
  private log_manager: LogManager | null = null;

  /**
   * 生命周期管理器只接收宿主参数，端口、token 与进程句柄都由自身拥有。
   */
  public constructor(options: CoreLifecycleManagerOptions) {
    this.options = options;
  }

  /**
   * Electron 退出钩子只需要终态判断，避免重复进入 stop_core 收尾链路。
   */
  public isStopped(): boolean {
    return this.state === "idle" || this.state === "stopped" || this.state === "failed";
  }

  /**
   * 启动顺序固定在这里，确保 Core 拿到的 database/log/Gateway 地址彼此一致。
   */
  public async start(): Promise<CoreLifecycleStartResult> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Core 生命周期状态不允许启动：${this.state}`);
    }

    this.state = "starting";
    const py_core_instance_token = create_instance_token();
    const public_port = await allocate_core_api_port();
    const py_core_port = await allocate_core_api_port();
    const public_base_url = build_core_api_base_url(public_port);
    const py_core_base_url = build_core_api_base_url(py_core_port);
    const launch_environment = {
      appRoot: this.options.appRoot,
      env: process.env,
      platform: process.platform,
    };
    const app_root = resolve_core_app_root(launch_environment);
    const launch_command = resolve_core_launch_command(launch_environment);
    const log_manager = new LogManager({
      logDir: new AppPathService({ appRoot: app_root }).get_log_dir(),
    });
    this.log_manager = log_manager;
    set_electron_main_log_manager(log_manager);
    // Database 必须先于 Core 启动，Core 启动后会立即按 env 创建 DatabaseGateway。
    const database_start_result = await this.database_server.start();
    let has_logged_start_failure = false;

    write_ts_lifecycle_log(`Database Service 已启动 - ${database_start_result.baseUrl}`);
    write_ts_lifecycle_log("Python Core 正在以内网端口启动 …");

    const spawn_request = build_core_process_spawn_request(
      launch_command,
      py_core_base_url,
      py_core_instance_token,
      database_start_result.baseUrl,
      database_start_result.token,
      public_base_url,
      py_core_instance_token,
    );
    const core_process = spawn(spawn_request.command, spawn_request.args, spawn_request.options);
    attach_core_process_output(core_process);
    if (core_process.pid !== undefined) {
      write_ts_lifecycle_log(
        `Python Core PID[${core_process.pid}] 内部实例已启动 - ${py_core_base_url}`,
      );
    }
    const handle = {
      process: core_process,
      exitPromise: create_exit_promise(core_process),
    };

    this.handle = handle;
    this.py_core_base_url = py_core_base_url;
    this.py_core_instance_token = py_core_instance_token;

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

    let gateway_start_result: CoreLifecycleStartResult | null = null;
    try {
      await Promise.race([
        wait_for_core_health(py_core_base_url, py_core_instance_token),
        handle.exitPromise.then((result) => {
          throw new Error(`Python Core 在健康检查通过前退出，退出码：${result.exitCode ?? "null"}`);
        }),
      ]);
      const gateway_server = new ApiGatewayServer({
        appRoot: app_root,
        publicPort: public_port,
        pyCoreBaseUrl: py_core_base_url,
        pyCoreToken: py_core_instance_token,
        database: this.database_server.get_database(),
        logManager: log_manager,
      });
      gateway_start_result = await gateway_server.start();
      this.gateway_server = gateway_server;
      await wait_for_core_health(gateway_start_result.baseUrl, gateway_start_result.instanceToken);
      write_ts_lifecycle_log(`TS Gateway 已启动 - ${gateway_start_result.baseUrl}`);
    } catch (error) {
      if (!has_logged_start_failure) {
        write_ts_lifecycle_log(`Core / Gateway 启动失败 - ${format_lifecycle_error(error)}`);
      }
      this.state = "failed";
      await this.stop_core(false);
      await this.database_server.stop();
      throw error;
    }

    process.env[CORE_API_BASE_URL_ENV_NAME] = public_base_url;
    process.env[DATABASE_API_BASE_URL_ENV_NAME] = database_start_result.baseUrl;
    this.state = "ready";
    if (gateway_start_result === null) {
      throw new Error("TS Gateway 启动状态丢失。");
    }
    return gateway_start_result;
  }

  /**
   * 退出请求统一汇入 stop_core，避免窗口事件和 IPC 各自清理后端进程。
   */
  public async stop(): Promise<void> {
    await this.stop_core(true);
  }

  /**
   * Core 关闭、Gateway 停止与 Database 释放必须保持同一拥有者顺序。
   */
  private async stop_core(should_log_lifecycle: boolean): Promise<void> {
    if (this.handle === null) {
      await this.gateway_server?.stop();
      this.gateway_server = null;
      await this.database_server.stop();
      await this.log_manager?.shutdown();
      this.log_manager = null;
      set_electron_main_log_manager(null);
      this.state = "stopped";
      return;
    }

    if (this.state === "stopping") {
      await wait_for_process_exit(this.handle);
      return;
    }

    const current_handle = this.handle;
    const current_base_url = this.py_core_base_url;
    const current_instance_token = this.py_core_instance_token;
    const current_pid = current_handle.process.pid;
    this.state = "stopping";
    if (should_log_lifecycle) {
      write_ts_lifecycle_log("Python Core 正在关闭 …");
    }

    let was_force_killed = false;

    if (current_base_url !== null && current_instance_token !== null) {
      try {
        await request_core_shutdown(current_base_url, current_instance_token);
      } catch (error) {
        this.log_manager?.warning("Python Core 优雅关闭请求失败，将继续执行进程清理。", {
          source: "ts-lifecycle",
          error_message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
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
    this.py_core_base_url = null;
    this.py_core_instance_token = null;
    await this.gateway_server?.stop();
    this.gateway_server = null;
    await this.database_server.stop();
    this.state = "stopped";
    if (should_log_lifecycle) {
      write_ts_lifecycle_log(format_core_shutdown_completed_log(current_pid, was_force_killed));
    }
    await this.log_manager?.shutdown();
    this.log_manager = null;
    set_electron_main_log_manager(null);
  }
}
