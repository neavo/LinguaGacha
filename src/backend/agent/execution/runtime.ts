import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AppPathService } from "../../app/app-path-service";
import type { InferenceConfiguration } from "../inference/runtime";
import { default_native_fs } from "../../../native/native-fs";
import { Supervisor, type SupervisedProcessResult } from "../../../native/supervisor";
import { resolve_workspace_runtime_entry } from "../../../native/workspace-runtime";
import { WorkspaceProxy } from "../../network/workspace-proxy";
import type { ProxyResolver } from "../../network/proxy-route";
import { AppError } from "../../../shared/error";
import { read_agent_process_output, type AgentProcessOutput } from "../process-output";
import type { UvConfiguration } from "../uv/types";
import type { WorkspaceResource } from "../workspace/runtime/protocol";
import { wait_for_operation } from "../wait-for-operation";
import { prepare_aria2 } from "./aria2";
import { WorkspaceResourceLeases } from "./resource-leases";

/** 本次执行的两路日志与时限，日志路径相对于工作区。 */
export type AgentExecutionRequest = Readonly<{
  workspacePath: string; // 日志属于当前对话，Node 环境仍是共享工程。
  stdoutPath: string;
  stderrPath: string;
  timeoutMs: number; // 等待环境与脚本共用截止时间，收尾完成后才释放占用。
}>;
// 进程结果与收尾后读取的两路日志。
export type AgentExecutionResult = SupervisedProcessResult &
  Readonly<{ stdout: AgentProcessOutput; stderr: AgentProcessOutput }>;

/** 环境准备失败与超时携带可补读的日志，runner 投影为工作区执行失败。 */
export class AgentExecutionError extends Error {
  /** 两类失败共用回执，原始原因保留给诊断。 */
  public constructor(
    message: string,
    public readonly execution: AgentExecutionResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** 共享环境准备只执行一次，每次运行分别拥有代理和进程树。 */
export class AgentExecutionRuntime {
  public readonly nodeExecutable: string;
  public readonly runtimeDirectory: string; // 随应用版本固定的运行资源。
  public readonly fontsDirectory: string; // 应用随附字体，Agent 工作区只读引用。
  public readonly nodeRoot: string; // 跨应用更新保留的用户 npm 工程。
  public readonly inference: InferenceConfiguration; // 宿主固定媒体路径，根脚本通过 IPC 接收。
  public readonly uv: UvConfiguration; // 经 IPC 固定根脚本使用的 uv 与共享数据根。
  private readonly leases = new WorkspaceResourceLeases();
  private readonly run_leases = new WeakMap<Supervisor, Set<() => void>>(); // 进程树回收后才归还遗留资源。
  private readonly preparation_lock: string;
  private readonly aria2Directory: string; // 应用管理的共享命令目录。
  private readonly lifetime = new AbortController();
  private readonly active_runs = new Set<Promise<unknown>>();
  private preparation: Promise<void> | undefined; // 成功后复用，失败后的下一条脚本可重新准备。
  private closing: Promise<void> | undefined;

  /** 冻结本实例的发布目录和数据根，执行期间不重新选择环境。 */
  public constructor(
    private readonly options: {
      runtimeDirectory: string;
      fontsDirectory: string;
      executablePath?: string;
      electronVersion?: string;
      paths: Pick<
        AppPathService,
        | "get_agent_node_root_dir"
        | "get_agent_preparation_lock_path"
        | "get_agent_python_root_dir"
        | "get_agent_models_dir"
        | "get_agent_media_cache_dir"
        | "get_user_data_path"
      >;
      proxyResolver: ProxyResolver;
    },
  ) {
    this.nodeExecutable = path.resolve(options.executablePath ?? process.execPath);
    this.runtimeDirectory = path.resolve(options.runtimeDirectory);
    this.fontsDirectory = path.resolve(options.fontsDirectory);
    this.nodeRoot = path.resolve(options.paths.get_agent_node_root_dir());
    this.inference = Object.freeze({
      modelsDirectory: path.resolve(options.paths.get_agent_models_dir()),
      cacheDirectory: path.resolve(options.paths.get_agent_media_cache_dir()),
      runtimeDirectory: this.runtimeDirectory,
    });
    this.preparation_lock = options.paths.get_agent_preparation_lock_path();
    this.aria2Directory = options.paths.get_user_data_path("bin", "aria2");
    this.uv = Object.freeze({
      pythonRoot: path.resolve(options.paths.get_agent_python_root_dir()),
      uvExecutable: path.join(
        this.runtimeDirectory,
        "bin",
        `${process.platform}-${process.arch}`,
        process.platform === "win32" ? "uv.exe" : "uv",
      ),
    });
  }

  /** 每次运行独立等待环境，直到脚本、宿主请求、代理及日志句柄全部收尾。 */
  public async with_environment<T>(
    request: AgentExecutionRequest,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.lifetime.signal.throwIfAborted();
    signal.throwIfAborted();
    const deadline = AbortSignal.timeout(request.timeoutMs);
    const effective = AbortSignal.any([signal, this.lifetime.signal, deadline]);
    const operation = this.execute(request, effective, action);
    this.active_runs.add(operation);
    try {
      return await operation;
    } catch (error) {
      if (deadline.aborted && effective.reason === deadline.reason && error === effective.reason) {
        // 无输出秒数让 Agent 区分卡住与仍在推进。两路日志在执行前创建，从未输出时即为整段执行时长。
        const last_output = Math.max(
          ...[request.stdoutPath, request.stderrPath].map(
            (log) => default_native_fs.stat(path.join(request.workspacePath, log)).mtimeMs,
          ),
        );
        throw new AgentExecutionError(
          `Workspace execution timed out after ${request.timeoutMs / 1000} seconds. No output in the last ${Math.round((Date.now() - last_output) / 1000)} seconds.`,
          this.result(request, { exitCode: null, signal: null }),
          { cause: error },
        );
      }
      throw error;
    } finally {
      this.active_runs.delete(operation);
    }
  }

  /** 独立代理和监管程序在本次执行内结算。 */
  private async execute<T>(
    request: AgentExecutionRequest,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    await Promise.all([
      default_native_fs.write_file(path.join(request.workspacePath, request.stdoutPath), ""),
      default_native_fs.write_file(path.join(request.workspacePath, request.stderrPath), ""),
    ]);
    try {
      await this.wait_for_preparation(signal);
    } catch (error) {
      if (!(error instanceof AgentExecutionError)) throw error;
      const { stdout, stderr, exitCode, signal: process_signal } = error.execution;
      // 准备日志随共享操作清理。每个等待者把回执复制到自己的工作区。
      await Promise.all([
        this.write_preparation_output(request.workspacePath, request.stdoutPath, stdout),
        this.write_preparation_output(request.workspacePath, request.stderrPath, stderr),
      ]);
      throw new AgentExecutionError(
        error.message,
        this.result(request, { exitCode, signal: process_signal }),
        { cause: error },
      );
    }
    const owner = await Supervisor.acquire(this.runtimeDirectory, undefined, signal);
    return await this.with_supervisor(owner, async (env) => {
      signal.throwIfAborted();
      return await action(owner, env, signal);
    });
  }

  /** 单次脚本的取消只结束自己的等待，共享准备由应用生命周期管理。 */
  private async wait_for_preparation(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.preparation ??= this.prepare_environment().catch((error: unknown) => {
      this.preparation = undefined;
      throw error;
    });
    await wait_for_operation(this.preparation, signal);
  }

  /** 失败回执引用本次脚本的日志，临时准备日志随共享操作清理。 */
  private write_preparation_output(
    workspace: string,
    relative: string,
    output: AgentProcessOutput,
  ): Promise<void> {
    const content =
      "content" in output
        ? typeof output.content === "string"
          ? output.content
          : JSON.stringify(output.content)
        : `Node environment preparation output exceeded the inline limit (${output.bytes} bytes).\n`;
    return default_native_fs.write_file(path.join(workspace, relative), content);
  }

  /** 启动准备程序和 aria2 部署共享同一跨进程锁。 */
  private async prepare_environment(): Promise<void> {
    const signal = this.lifetime.signal;
    const logs = await default_native_fs.make_temp_dir(path.join(os.tmpdir(), "lg-prepare-"));
    const request: AgentExecutionRequest = {
      workspacePath: logs,
      stdoutPath: "stdout.log",
      stderrPath: "stderr.log",
      timeoutMs: 0,
    };
    try {
      const owner = await this.acquire_preparation_lock(signal);
      await this.with_supervisor(owner, async (env) => {
        signal.throwIfAborted();
        prepare_aria2(this.runtimeDirectory, this.aria2Directory);
        const result = await owner.launch(
          {
            executable: this.nodeExecutable,
            args: [
              resolve_workspace_runtime_entry(this.runtimeDirectory, "prepare"),
              this.runtimeDirectory,
              this.nodeRoot,
            ],
            cwd: this.runtimeDirectory,
            env,
            stdout: path.join(logs, request.stdoutPath),
            stderr: path.join(logs, request.stderrPath),
          },
          signal,
        );
        if (result.exitCode !== 0)
          throw new AgentExecutionError(
            "Node environment preparation failed.",
            this.result(request, result),
          );
      });
    } finally {
      await default_native_fs.remove_async(logs, { force: true, recursive: true });
    }
  }

  /** 仅对另一实例正占用的锁重试，启动和系统错误直接返回。 */
  private async acquire_preparation_lock(signal: AbortSignal): Promise<Supervisor> {
    const retry_interval_ms = 250;
    for (;;) {
      try {
        return await Supervisor.acquire(this.runtimeDirectory, this.preparation_lock, signal);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "runtime.busy") throw error;
        try {
          await delay(retry_interval_ms, undefined, { signal });
        } catch (error) {
          signal.throwIfAborted();
          throw error;
        }
      }
    }
  }

  /** 子进程未主动归还的占用，在监管程序确认回收后释放。 */
  public async acquire_resource(
    owner: Supervisor,
    resource: WorkspaceResource,
    signal: AbortSignal,
  ): Promise<() => void> {
    const owned = this.run_leases.get(owner);
    if (!owned) throw new Error("Workspace is not running.");
    const release = await this.leases.acquire(resource, signal);
    owned.add(release);
    return () => {
      if (owned.delete(release)) release();
    };
  }

  /** 目标、代理和监管程序沿同一顺序结算，清理故障保留执行主因。 */
  private async with_supervisor<T>(
    owner: Supervisor,
    action: (env: NodeJS.ProcessEnv) => Promise<T>,
  ): Promise<T> {
    let proxy: WorkspaceProxy | undefined;
    let failure: unknown;
    let value: T | undefined;
    const leases = new Set<() => void>();
    this.run_leases.set(owner, leases);
    try {
      proxy = await WorkspaceProxy.start(this.options.proxyResolver);
      value = await action(this.environment(proxy.url));
    } catch (error) {
      failure = error;
    }
    {
      const errors: unknown[] = [];
      // 代理连接先关闭，跨实例租约最后释放。
      for (const resource of [proxy, owner]) {
        try {
          await resource?.close();
        } catch (error) {
          errors.push(error);
        }
      }
      this.run_leases.delete(owner);
      for (const release of leases) release();
      if (errors.length > 0)
        throw new AggregateError(
          [...(failure === undefined ? [] : [failure]), ...errors],
          "Agent execution operation cleanup failed.",
          failure === undefined ? undefined : { cause: failure },
        );
    }
    if (failure !== undefined) throw failure;
    return value as T;
  }

  /** 进程收尾后读取日志，避免把仍在写入的输出当作最终回执。 */
  private result(
    request: AgentExecutionRequest,
    result: SupervisedProcessResult,
  ): AgentExecutionResult {
    return {
      ...result,
      stdout: read_agent_process_output(request.workspacePath, request.stdoutPath),
      stderr: read_agent_process_output(request.workspacePath, request.stderrPath),
    };
  }

  /** 隔离宿主 npm 配置，让共享工程的 npmrc 拥有后续配置选择。 */
  private environment(proxy: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // npm run dev 的父进程会注入 cache/prefix，继承它们会压过共享工程的 npmrc。
    for (const name of Object.keys(env)) {
      if (
        /^(?:https?_proxy|all_proxy|no_proxy|node_options|npm_config_(?:userconfig|globalconfig|cache|prefix|proxy|https_proxy|noproxy))$/iu.test(
          name,
        )
      )
        delete env[name];
    }
    const version = this.options.electronVersion ?? process.versions.electron;
    if (!version) throw new Error("Electron version is required for the Agent Node environment.");
    const bin = path.join(this.runtimeDirectory, "bin", `${process.platform}-${process.arch}`);
    const global_bin = path.join(
      this.nodeRoot,
      "global",
      ...(process.platform === "win32" ? [] : ["bin"]),
    );
    const path_key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
    return {
      ...env,
      [path_key]: [this.aria2Directory, bin, global_bin, env[path_key] ?? ""].join(path.delimiter),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "",
      LG_NODE_ROOT: this.nodeRoot,
      LG_NODE_EXECUTABLE: this.nodeExecutable,
      LG_NPM_CLI_ROOT: path.join(this.runtimeDirectory, "npm/bin"),
      npm_config_userconfig: path.join(this.nodeRoot, "npmrc"),
      npm_config_globalconfig: path.join(this.nodeRoot, "global.npmrc"),
      HTTP_PROXY: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
      npm_package_config_node_gyp_target: version,
      npm_package_config_node_gyp_arch: process.arch,
      npm_package_config_node_gyp_dist_url: "https://electronjs.org/headers",
      npm_package_config_node_gyp_devdir: path.join(this.nodeRoot, "cache/node-gyp"),
      npm_config_runtime: "electron",
      npm_config_target: version,
      npm_config_arch: process.arch,
    };
  }

  /** 取消全部执行并等待每个进程树收尾，调用方取消不计为关闭失败。 */
  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.lifetime.abort(new Error("Agent execution runtime closed."));
    this.closing = Promise.allSettled([...this.active_runs, this.preparation]).then((results) => {
      const failures = results.flatMap((result) =>
        result.status === "rejected" && result.reason instanceof AggregateError
          ? [result.reason]
          : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, "Agent execution cleanup failed.");
    });
    return this.closing;
  }
}
