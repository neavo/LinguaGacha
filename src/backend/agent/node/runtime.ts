import path from "node:path";
import type { AppPathService } from "../../app/app-path-service";
import { default_native_fs } from "../../../native/native-fs";
import { Supervisor, type SupervisedProcessResult } from "../../../native/supervisor";
import { resolve_workspace_runtime_entry } from "../../../native/workspace-runtime";
import { NpmProxy } from "../../network/npm-proxy";
import type { ProxyResolver } from "../../network/proxy-http-client";
import { AppError } from "../../../shared/error";
import { read_agent_process_output, type AgentProcessOutput } from "../process-output";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";
import { parse_workspace_command, type AgentWorkspaceCommand } from "./arguments";

export type AgentWorkspaceExecRequest = Readonly<{
  workspacePath: string; // 日志属于当前对话，命令的 cwd 仍是共享工程。
  command: string;
  stdoutPath: string;
  stderrPath: string;
}>;
export type AgentWorkspaceExecResult = SupervisedProcessResult &
  Readonly<{ cwd: string; stdout: AgentProcessOutput; stderr: AgentProcessOutput }>;

/** 执行失败携带可补读的日志，供服务层投影为工具回执。 */
export class AgentNodeExecError extends Error {
  /** 超时和非零退出共用回执，原始原因保留给诊断。 */
  public constructor(
    message: string,
    public readonly execution: AgentWorkspaceExecResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** GUI 组合根拥有此运行态，用户依赖只由受监管的准备程序和 npm 写入。 */
export class AgentNodeRuntime {
  public readonly executable: string;
  public readonly directory: string; // 随应用版本固定的运行资源。
  public readonly root: string; // 跨应用更新保留的用户 npm 工程。
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
      paths: Pick<AppPathService, "get_agent_node_root_dir" | "get_agent_node_lock_path">;
      proxyResolver: ProxyResolver;
    },
  ) {
    this.executable = path.resolve(options.executablePath ?? process.execPath);
    this.directory = path.resolve(options.runtimeDirectory);
    this.root = path.resolve(options.paths.get_agent_node_root_dir());
    this.lock = options.paths.get_agent_node_lock_path();
  }

  /** 命令只决定启动的 CLI 与其 argv，时限、监管和回执由本入口统一负责并覆盖环境准备。 */
  public async run_exec(
    request: AgentWorkspaceExecRequest,
    signal: AbortSignal,
  ): Promise<AgentWorkspaceExecResult> {
    let command: AgentWorkspaceCommand;
    try {
      command = parse_workspace_command(request.command);
    } catch (cause) {
      throw new AppError("request.validation_failed", {
        cause,
        public_details: { message: cause instanceof Error ? cause.message : String(cause) },
      });
    }
    const deadline = AbortSignal.any([
      signal,
      AbortSignal.timeout(AGENT_WORKSPACE_RUNTIME_POLICY.nodeTimeoutMs),
    ]);
    try {
      return await this.with_environment(
        request,
        deadline,
        async (owner, env, execution_signal) => {
          const result = await owner.launch(
            {
              executable: this.executable,
              args: [path.join(this.directory, command.entry), ...command.args],
              cwd: this.root,
              env,
              stdout: path.join(request.workspacePath, request.stdoutPath),
              stderr: path.join(request.workspacePath, request.stderrPath),
            },
            execution_signal,
          );
          const execution = this.result(request, result);
          if (result.exitCode !== 0)
            throw new AgentNodeExecError("Command exited unsuccessfully.", execution);
          return execution;
        },
      );
    } catch (error) {
      if (!signal.aborted && deadline.aborted && error === deadline.reason)
        throw new AgentNodeExecError(
          "Command timed out.",
          this.result(request, { exitCode: null, signal: null }),
          { cause: error },
        );
      throw error;
    }
  }

  /** 持有租约直到脚本、宿主请求、代理及日志句柄全部收尾。 */
  public async with_environment<T>(
    request: Pick<AgentWorkspaceExecRequest, "workspacePath" | "stdoutPath" | "stderrPath">,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) throw new Error("Agent Node runtime is closed.");
    if (this.active) throw new AppError("runtime.busy");
    this.controller = new AbortController();
    const effective = AbortSignal.any([signal, this.controller.signal]);
    const operation = this.execute(request, effective, action);
    this.active = operation;
    try {
      return await operation;
    } finally {
      this.active = undefined;
      this.controller = undefined;
    }
  }

  /** 目标、代理和租约沿同一顺序结算，清理故障保留执行主因。 */
  private async execute<T>(
    request: Pick<AgentWorkspaceExecRequest, "workspacePath" | "stdoutPath" | "stderrPath">,
    signal: AbortSignal,
    action: (owner: Supervisor, env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    await default_native_fs.write_file(path.join(request.workspacePath, request.stdoutPath), "");
    await default_native_fs.write_file(path.join(request.workspacePath, request.stderrPath), "");
    const owner = await Supervisor.acquire(this.directory, this.lock);
    let proxy: NpmProxy | undefined;
    let failure: unknown;
    let value: T | undefined;
    try {
      proxy = await NpmProxy.start(this.options.proxyResolver);
      const env = this.environment(proxy.url);
      const preparation = AbortSignal.any([
        signal,
        AbortSignal.timeout(AGENT_WORKSPACE_RUNTIME_POLICY.nodeTimeoutMs),
      ]);
      let result: SupervisedProcessResult;
      try {
        result = await owner.launch(
          {
            executable: this.executable,
            args: [
              resolve_workspace_runtime_entry(this.directory, "prepare"),
              this.directory,
              this.root,
            ],
            cwd: this.directory,
            env,
            stdout: path.join(request.workspacePath, request.stdoutPath),
            stderr: path.join(request.workspacePath, request.stderrPath),
          },
          preparation,
        );
      } catch (error) {
        if (!signal.aborted && preparation.aborted && error === preparation.reason)
          throw new AgentNodeExecError(
            "Node environment preparation timed out.",
            this.result(request, { exitCode: null, signal: null }),
            { cause: error },
          );
        throw error;
      }
      if (result.exitCode !== 0)
        throw new AgentNodeExecError(
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
          "Agent Node operation cleanup failed.",
          failure === undefined ? undefined : { cause: failure },
        );
    }
    if (failure !== undefined) throw failure;
    return value as T;
  }

  /** 进程收尾后读取日志，避免把仍在写入的输出当作最终回执。 */
  private result(
    request: Pick<AgentWorkspaceExecRequest, "workspacePath" | "stdoutPath" | "stderrPath">,
    result: SupervisedProcessResult,
  ): AgentWorkspaceExecResult {
    return {
      cwd: this.root,
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
    const bin = path.join(this.directory, "bin", `${process.platform}-${process.arch}`);
    const global_bin = path.join(
      this.root,
      "global",
      ...(process.platform === "win32" ? [] : ["bin"]),
    );
    const path_key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
    return {
      ...env,
      [path_key]: [bin, global_bin, env[path_key] ?? ""].join(path.delimiter),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: "",
      LG_NODE_ROOT: this.root,
      LG_NODE_EXECUTABLE: this.executable,
      LG_NPM_CLI_ROOT: path.join(this.directory, "npm/bin"),
      npm_config_userconfig: path.join(this.root, "npmrc"),
      npm_config_globalconfig: path.join(this.root, "global.npmrc"),
      HTTP_PROXY: proxy,
      http_proxy: proxy,
      HTTPS_PROXY: proxy,
      https_proxy: proxy,
      npm_package_config_node_gyp_target: version,
      npm_package_config_node_gyp_arch: process.arch,
      npm_package_config_node_gyp_dist_url: "https://electronjs.org/headers",
      npm_package_config_node_gyp_devdir: path.join(this.root, "cache/node-gyp"),
      npm_config_runtime: "electron",
      npm_config_target: version,
      npm_config_arch: process.arch,
    };
  }

  /** 先停止受理新执行，再取消并等待当前操作收尾。 */
  public async close(): Promise<void> {
    this.closed = true;
    this.controller?.abort(new Error("Agent Node runtime closed."));
    await this.active;
  }
}
