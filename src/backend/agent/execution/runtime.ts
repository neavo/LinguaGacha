import path from "node:path";
import type { AppPathService } from "../../app/app-path-service";
import { default_native_fs } from "../../../native/native-fs";
import { Supervisor, type SupervisedProcessResult } from "../../../native/supervisor";
import { resolve_workspace_runtime_entry } from "../../../native/workspace-runtime";
import { WorkspaceProxy } from "../../network/workspace-proxy";
import type { ProxyResolver } from "../../network/proxy-route";
import { AppError } from "../../../shared/error";
import { read_agent_process_output, type AgentProcessOutput } from "../process-output";

/** 本次执行的两路日志与时限，日志路径相对于工作区。 */
export type AgentExecutionRequest = Readonly<{
  workspacePath: string; // 日志属于当前对话，Node 环境仍是共享工程。
  stdoutPath: string;
  stderrPath: string;
  timeoutMs: number; // 租约、环境准备和脚本共用一个截止时间，收尾完成后才释放占用。
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

/** GUI 组合根拥有共享租约，Node 准备和根脚本的所有后代（含 SDK 启动的 npm、Python）沿同一生命周期收尾。 */
export class AgentExecutionRuntime {
  public readonly nodeExecutable: string;
  public readonly runtimeDirectory: string; // 随应用版本固定的运行资源。
  public readonly nodeRoot: string; // 跨应用更新保留的用户 npm 工程。
  public readonly python: Readonly<{ pythonRoot: string; uvExecutable: string }>;
  private readonly lock: string;
  private active: Promise<unknown> | undefined; // 关闭等待整个操作结算，不能只等目标进程。
  private controller: AbortController | undefined; // 应用关闭与调用方取消合并到本次操作。
  private closed = false;

  /** 冻结本实例的发布目录和数据根，执行期间不重新选择环境。 */
  public constructor(
    private readonly options: {
      runtimeDirectory: string;
      executablePath?: string;
      electronVersion?: string;
      paths: Pick<
        AppPathService,
        "get_agent_node_root_dir" | "get_agent_execution_lock_path" | "get_agent_python_root_dir"
      >;
      proxyResolver: ProxyResolver;
    },
  ) {
    this.nodeExecutable = path.resolve(options.executablePath ?? process.execPath);
    this.runtimeDirectory = path.resolve(options.runtimeDirectory);
    this.nodeRoot = path.resolve(options.paths.get_agent_node_root_dir());
    this.lock = options.paths.get_agent_execution_lock_path();
    this.python = Object.freeze({
      pythonRoot: path.resolve(options.paths.get_agent_python_root_dir()),
      uvExecutable: path.join(
        this.runtimeDirectory,
        "bin",
        `${process.platform}-${process.arch}`,
        process.platform === "win32" ? "uv.exe" : "uv",
      ),
    });
  }

  /** 持有租约直到脚本、宿主请求、代理及日志句柄全部收尾。 */
  public async with_environment<T>(
    request: AgentExecutionRequest,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error("Agent execution runtime is closed.");
    if (this.active) throw new AppError("runtime.busy");
    this.controller = new AbortController();
    const deadline = AbortSignal.timeout(request.timeoutMs);
    const effective = AbortSignal.any([signal, this.controller.signal, deadline]);
    const operation = this.execute(request, effective, action);
    this.active = operation;
    try {
      return await operation;
    } catch (error) {
      if (deadline.aborted && effective.reason === deadline.reason && error === effective.reason)
        throw new AgentExecutionError(
          `Workspace execution timed out after ${request.timeoutMs / 1000} seconds.`,
          this.result(request, { exitCode: null, signal: null }),
          { cause: error },
        );
      throw error;
    } finally {
      this.active = undefined;
      this.controller = undefined;
    }
  }

  /** 目标、代理和租约沿同一顺序结算，清理故障保留执行主因。 */
  private async execute<T>(
    request: AgentExecutionRequest,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    await default_native_fs.write_file(path.join(request.workspacePath, request.stdoutPath), "");
    await default_native_fs.write_file(path.join(request.workspacePath, request.stderrPath), "");
    const owner = await Supervisor.acquire(this.runtimeDirectory, this.lock, signal);
    let proxy: WorkspaceProxy | undefined;
    let failure: unknown;
    let value: T | undefined;
    try {
      proxy = await WorkspaceProxy.start(this.options.proxyResolver);
      const env = this.environment(proxy.url);
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
          stdout: path.join(request.workspacePath, request.stdoutPath),
          stderr: path.join(request.workspacePath, request.stderrPath),
        },
        signal,
      );
      if (result.exitCode !== 0)
        throw new AgentExecutionError(
          "Node environment preparation failed.",
          this.result(request, result),
        );
      signal.throwIfAborted();
      value = await action(owner, env, signal);
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
      [path_key]: [bin, global_bin, env[path_key] ?? ""].join(path.delimiter),
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

  /** 先停止受理新执行，再取消并等待当前操作收尾。 */
  public async close(): Promise<void> {
    this.closed = true;
    this.controller?.abort(new Error("Agent execution runtime closed."));
    await this.active;
  }
}
