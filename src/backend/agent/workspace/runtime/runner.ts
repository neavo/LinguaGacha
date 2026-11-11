import {
  execute_generate_files_request,
  execute_get_output_paths_request,
  type WorkspaceGetOutputPathsPort,
  type WorkspaceGenerateFilesPort,
} from "../../tools/generate-files";
import type { WorkspaceRequest } from "./protocol";
import { execute_image_request } from "../../tools/emit-image";
import { execute_doing_request } from "../../tools/doing";
import { execute_print_pdf_request, type WorkspacePrintPDFPort } from "../../tools/print-pdf";
import {
  execute_inspect_sources_request,
  type WorkspaceInspectSourcesPort,
} from "../../tools/inspect-sources";
import { fork, type ForkOptions } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AgentExecutionError,
  type AgentExecutionRequest,
  type AgentExecutionResult,
  type AgentExecutionRuntime,
} from "../../execution/runtime";
import type { Supervisor } from "../../../../native/supervisor";
import { read_agent_process_output } from "../../process-output";
import type { AgentImageOptions } from "../../../../shared/agent-image";
import { default_native_fs } from "../../../../native/native-fs";
import { resolve_workspace_runtime_entry } from "../../../../native/workspace-runtime";
import type { ProxyResolver } from "../../../network/proxy-route";
import type { AppPathService } from "../../../app/app-path-service";
import type { PackageSource } from "../../package-source";
import {
  AGENT_WORKSPACE_ENTRY_ENV,
  type AgentWorkspaceRuntimeChildMessage,
  type AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

export type AgentWorkspaceRunRequest = AgentExecutionRequest &
  Readonly<{
    scriptPath: string; // 同一执行的脚本与两路日志路径由 WorkspaceService 唯一确定
    generateFiles?: WorkspaceGenerateFilesPort;
    getOutputPaths?: WorkspaceGetOutputPathsPort;
    printPDF?: WorkspacePrintPDFPort;
    inspectSources?: WorkspaceInspectSourcesPort; // 父进程内绑定本次工作区执行，不经过 IPC 序列化
    emitImage?: (path: string, signal: AbortSignal, options?: AgentImageOptions) => Promise<void>;
    doing?: (text: string | null) => Promise<void>; // 本次执行借用会话写入口，不持有状态副本
    packageSource?: (signal: AbortSignal) => Promise<PackageSource>; // 已绑定受理时的对话
  }>;

type WorkspaceProcessResult = {
  exitCode: number | null;
  signal: string | null;
  failure?: string; // 可修复的执行失败，读取输出文件后再形成完整错误记录
};

export type AgentWorkspaceExecution = AgentExecutionResult & Readonly<{ scriptPath: string }>;

/** 程序失败保留可修复的执行记录。宿主故障继续使用应用诊断通道。 */
export class AgentWorkspaceRunError extends Error {
  /** 执行失败携带同一份输出记录，服务层直接投影给模型。 */
  public constructor(
    message: string,
    public readonly execution: AgentWorkspaceExecution,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** 父进程拥有执行、取消与回收。Node 自身拥有程序及其异步任务的完成语义。 */
export class AgentWorkspaceRunner {
  private readonly execution: AgentExecutionRuntime;
  private readonly proxy_resolver: ProxyResolver; // 经宿主查询当前 Session，子进程共用同一代理策略。
  private readonly paths: Pick<
    AppPathService,
    "get_agent_user_skill_dir" | "get_agent_builtin_skill_dir"
  >;

  /** 保存当前应用版本的启动资源与宿主代理端口。 */
  public constructor(options: {
    execution: AgentExecutionRuntime;
    proxyResolver: ProxyResolver;
    paths: Pick<AppPathService, "get_agent_user_skill_dir" | "get_agent_builtin_skill_dir">;
  }) {
    this.execution = options.execution;
    this.proxy_resolver = options.proxyResolver;
    this.paths = options.paths;
  }

  /** 等待 close 后才返回，调用方据此释放工作区互斥。 */
  public async run(
    request: AgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<AgentWorkspaceExecution> {
    try {
      return await this.execution.with_environment(
        request,
        signal,
        (owner, env, execution_signal) => this.run_prepared(request, execution_signal, owner, env),
      );
    } catch (error) {
      if (error instanceof AgentExecutionError)
        throw new AgentWorkspaceRunError(
          error.message,
          { scriptPath: request.scriptPath, ...error.execution },
          { cause: error },
        );
      throw error;
    }
  }

  /** 固定本次启动的资源路径与入口标记，再交给受监管的子进程执行。 */
  private async run_prepared(
    request: AgentWorkspaceRunRequest,
    signal: AbortSignal,
    owner: Supervisor,
    env: NodeJS.ProcessEnv,
  ): Promise<AgentWorkspaceExecution> {
    signal.throwIfAborted();
    // 宿主先解析祖先链接，cwd、预加载与模块根使用同一真实位置。
    const workspace_path = default_native_fs.real_path(request.workspacePath);
    const runtime_directory = default_native_fs.real_path(this.execution.runtimeDirectory);
    const bootstrap_path = resolve_workspace_runtime_entry(runtime_directory, "bootstrap");
    const user_skill_directory = this.paths.get_agent_user_skill_dir();
    default_native_fs.make_dir(user_skill_directory); // `ws.userSkillDirectory` 承诺目录存在
    // 技能模块可能经逻辑入口或真实位置加载，npm 依赖解析按两者匹配，每次 run 都重新解析。
    const skill_module_roots = [
      path.join(request.workspacePath, "work"),
      path.join(workspace_path, "work"),
      user_skill_directory,
      this.paths.get_agent_builtin_skill_dir(),
    ].flatMap((entry) => {
      try {
        return [entry, default_native_fs.real_path(entry)];
      } catch (error) {
        // 缺失的内置技能根不影响工作区执行，后续 run 会重新解析其真实位置。
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [entry];
        throw error;
      }
    });
    // 标准异步资源释放在返回或抛错前关闭句柄，第二路打开失败也会释放第一路。
    await using stdout = await default_native_fs.open_file(
      path.join(workspace_path, request.stdoutPath),
      "a",
    );
    await using stderr = await default_native_fs.open_file(
      path.join(workspace_path, request.stderrPath),
      "a",
    );
    const launch_options: ForkOptions & { windowsHide: boolean } = {
      execPath: this.execution.nodeExecutable,
      execArgv: [
        // 保留工作材料与技能的逻辑入口，模块解析钩子同时匹配逻辑位置和真实位置。
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        "--import",
        pathToFileURL(bootstrap_path).href,
      ],
      cwd: workspace_path,
      // 启动参数由 runner 拥有，禁止继承父进程的 Node 注入选项。入口标记只交给根进程。
      env: { ...env, [AGENT_WORKSPACE_ENTRY_ENV]: "1" },
      // Windows 跳过 libuv 的隐式 Job，让所有目标共用监管程序持有的具名 Job。
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout.fd, stderr.fd, "ipc"],
    };

    const process_result = await this.run_process(
      path.resolve(workspace_path, request.scriptPath),
      runtime_directory,
      user_skill_directory,
      [...new Set(skill_module_roots.map((entry) => pathToFileURL(entry + path.sep).href))],
      launch_options,
      signal,
      request,
      owner,
    );
    const execution: AgentWorkspaceExecution = {
      scriptPath: request.scriptPath,
      exitCode: process_result.exitCode,
      signal: process_result.signal,
      stdout: read_agent_process_output(workspace_path, request.stdoutPath),
      stderr: read_agent_process_output(workspace_path, request.stderrPath),
    };
    if (process_result.failure !== undefined)
      throw new AgentWorkspaceRunError(process_result.failure, execution);
    return execution;
  }

  /** 子进程直接写入日志文件。父进程只处理 IPC 和生命周期，close 后再读取结果。 */
  private run_process(
    script_path: string,
    runtime_directory: string,
    user_skill_directory: string,
    skill_roots: readonly string[],
    launch_options: ForkOptions,
    signal: AbortSignal,
    run_request: AgentWorkspaceRunRequest,
    owner: Supervisor,
  ): Promise<WorkspaceProcessResult> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = fork(script_path, [], launch_options);
      const requests = new Map<number, AbortController>();
      const operations = new Set<Promise<void>>(); // 回收前等待宿主资源实际结算
      let closed = false;
      let terminal_error: unknown; // 首个终止原因拥有结果，close 只负责回收与结算

      /** 终止当前进程时取消宿主等待，迟到响应不再投递。 */
      const abort_requests = (reason: unknown): void => {
        for (const controller of requests.values()) controller.abort(reason);
        requests.clear();
      };
      /** 所有强制终止路径共用一次回收。输出等 close 后收齐。 */
      const terminate = (reason: unknown): void => {
        if (terminal_error !== undefined) return;
        terminal_error = reason;
        abort_requests(reason);
        // attach 请求先于停止入队，由监管器结束目标，避免根进程先消失导致登记失败。
        owner.stop();
      };
      /** IPC 发送失败沿同一终止路径处理。 */
      const send = (message: AgentWorkspaceRuntimeParentMessage): void => {
        if (closed || !child.connected || terminal_error !== undefined) return;
        child.send(message, (error) => {
          if (error !== null) terminate(error);
        });
      };
      /** 参数在父进程信任边界收窄后才交给宿主能力。 */
      const handle_request = (id: number, request: WorkspaceRequest): void => {
        if (requests.has(id)) throw new Error("Workspace runtime reused a request id.");
        const controller = new AbortController();
        requests.set(id, controller);
        // 生命周期归 runner，参数校验与业务执行归具体工具。
        const execute = async () => {
          if (request.kind === "doing")
            return execute_doing_request(request, controller.signal, run_request.doing);
          if (request.kind === "emit_image")
            return await execute_image_request(request, controller.signal, run_request.emitImage);
          if (request.kind === "resolve_proxy" && typeof request.url === "string")
            return await this.proxy_resolver.resolveProxy(request.url, controller.signal);
          if (request.kind === "resolve_package_source") {
            if (!run_request.packageSource) throw new Error("Package source unavailable.");
            return await run_request.packageSource(controller.signal);
          }
          if (request.kind === "get_output_paths")
            return execute_get_output_paths_request(
              request,
              controller.signal,
              run_request.getOutputPaths,
            );
          if (request.kind === "generate_files")
            return execute_generate_files_request(
              request,
              controller.signal,
              run_request.generateFiles,
            );
          if (request.kind === "print_pdf")
            return execute_print_pdf_request(request, controller.signal, run_request.printPDF);
          if (request.kind === "inspect_sources")
            return execute_inspect_sources_request(
              request,
              controller.signal,
              run_request.inspectSources,
            );
          throw new Error("Invalid workspace request.");
        };
        const operation = execute()
          .then(
            (value) => {
              if (requests.get(id) !== controller || controller.signal.aborted) return;
              send({ type: "response", id, result: { ok: true, value } });
            },
            (error: unknown) => {
              if (requests.get(id) !== controller || controller.signal.aborted) return;
              send({
                type: "response",
                id,
                result: {
                  ok: false,
                  message: error instanceof Error ? error.message : String(error),
                },
              });
            },
          )
          .finally(() => {
            requests.delete(id);
            operations.delete(operation);
          });
        operations.add(operation);
      };
      const abort_listener = (): void => terminate(signal.reason);
      signal.addEventListener("abort", abort_listener, { once: true });
      child.on("message", (message: AgentWorkspaceRuntimeChildMessage) => {
        if (terminal_error !== undefined) return;
        try {
          switch (message.type) {
            case "request":
              handle_request(message.id, message.request);
              break;
            case "cancel":
              requests.get(message.id)?.abort(new Error("Workspace request was cancelled."));
              break;
            default:
              throw new Error("Workspace runtime sent an invalid message.");
          }
        } catch (error) {
          terminate(error);
        }
      });
      child.once("error", terminate);
      child.once("close", (exitCode, exitSignal) => {
        closed = true;
        signal.removeEventListener("abort", abort_listener);
        abort_requests(new Error("Workspace process closed."));
        void Promise.allSettled([supervision, ...operations]).then(([supervisor_result]) => {
          if (supervisor_result?.status === "rejected") {
            reject(supervisor_result.reason);
            return;
          }
          if (terminal_error !== undefined) reject(terminal_error);
          else
            resolve({
              exitCode,
              signal: exitSignal ?? null,
              ...(exitCode !== 0 ? { failure: "Workspace program exited unsuccessfully." } : {}),
            });
        });
      });
      const supervision = (async () => {
        try {
          if (child.pid === undefined) throw new Error("Workspace process did not start.");
          await owner.attach(child.pid);
          send({
            type: "start",
            userSkillDirectory: user_skill_directory,
            fontsDirectory: this.execution.fontsDirectory,
            nodeRoot: this.execution.nodeRoot,
            runtimeDirectory: runtime_directory,
            moduleRoots: skill_roots,
            uv: this.execution.uv,
            media: this.execution.media,
          });
          await owner.settle(signal);
        } catch (error) {
          terminate(error);
          // 监管失败时由宿主回收根进程。正常停止与超时由监管器回收进程树。
          if (!signal.aborted || error !== signal.reason) child.kill("SIGKILL");
          throw error;
        }
      })();
      // close 的结算路径消费监管失败，提前注册避免在进程退出前成为未处理拒绝。
      void supervision.catch(() => {});
      if (signal.aborted) abort_listener();
    });
  }
}
