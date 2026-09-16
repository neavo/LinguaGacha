import { fork, type ForkOptions } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { is_json_record, type JsonRecord, type JsonValue } from "../../../../domain/json";
import { normalize_agent_todos } from "../../../../shared/agent-todo";
import { default_native_fs } from "../../../../native/native-fs";
import type { SystemProxyResolver } from "../../../network/system-proxy-http-client";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import type {
  AgentWorkspaceRuntimeChildMessage,
  AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

export type AgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  scriptPath: string; // 同一执行的三个文件路径由 WorkspaceService 唯一确定
  stdoutPath: string;
  stderrPath: string;
  todos: readonly string[];
}>;

export type AgentWorkspaceOutputContent = string | JsonRecord | JsonValue[];

/** 文件保存完整原文。小输出附带内容，大输出只提供补读提示。 */
export type AgentWorkspaceOutput = Readonly<
  {
    path: string;
    bytes: number;
  } & ({ content: AgentWorkspaceOutputContent } | { message: string })
>;

type WorkspaceProcessResult = {
  exitCode: number | null;
  signal: string | null;
  todos: string[];
  failure?: string; // 可修复的执行失败，读取输出文件后再形成完整错误记录
};

export type AgentWorkspaceExecution = Readonly<{
  scriptPath: string;
  exitCode: number | null;
  signal: string | null;
  stdout: AgentWorkspaceOutput;
  stderr: AgentWorkspaceOutput;
}>;

export type AgentWorkspaceRunResult = Readonly<{
  execution: AgentWorkspaceExecution;
  todos: string[];
}>;

/** 程序失败保留可修复的执行记录；宿主故障继续使用应用诊断通道。 */
export class AgentWorkspaceRunError extends Error {
  /** 执行失败携带同一份输出记录，服务层直接投影给模型。 */
  public constructor(
    message: string,
    public readonly execution: AgentWorkspaceExecution,
  ) {
    super(message);
  }
}

/** 父进程拥有执行、取消与回收；Node 自身拥有程序及其异步任务的完成语义。 */
export class AgentWorkspaceRunner {
  private readonly executable_path: string;
  private readonly bootstrap_path: string;
  private readonly system_proxy_resolver: SystemProxyResolver;

  /** 保存当前应用版本的启动资源与宿主代理端口。 */
  public constructor(options: {
    executablePath?: string;
    runtimeBootstrapPath: string;
    systemProxyResolver: SystemProxyResolver;
  }) {
    this.executable_path = path.resolve(options.executablePath ?? process.execPath);
    this.bootstrap_path = path.resolve(options.runtimeBootstrapPath);
    this.system_proxy_resolver = options.systemProxyResolver;
  }

  /** 等待 close 后才返回，调用方据此释放工作区互斥并提交 Todo。 */
  public async run(
    request: AgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<AgentWorkspaceRunResult> {
    signal.throwIfAborted();
    // 宿主先解析祖先链接，cwd、预加载与授权使用同一真实位置，子进程无需读取上层链接。
    const workspace_path = default_native_fs.real_path(request.workspacePath);
    const bootstrap_path = default_native_fs.real_path(this.bootstrap_path);
    const write_paths = new Set(
      AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots.flatMap((name) => {
        const entry = path.join(workspace_path, name);
        return [entry, default_native_fs.real_path(entry)];
      }),
    );
    const read_paths = new Set([workspace_path, path.dirname(bootstrap_path), ...write_paths]);
    // 标准异步资源释放在返回或抛错前关闭句柄，第二路打开失败也会释放第一路。
    await using stdout = await default_native_fs.open_file(
      path.join(workspace_path, request.stdoutPath),
      "w",
    );
    await using stderr = await default_native_fs.open_file(
      path.join(workspace_path, request.stderrPath),
      "w",
    );
    const launch_options: ForkOptions & { windowsHide: boolean } = {
      execPath: this.executable_path,
      execArgv: [
        "--permission",
        ...[...read_paths].map((directory) => `--allow-fs-read=${directory}`),
        ...[...write_paths].map((directory) => `--allow-fs-write=${directory}`),
        // 包括主程序在内都按工作区入口解析模块；work 本身是链接时仍能发现工作区 node_modules。
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        "--import",
        pathToFileURL(bootstrap_path).href,
      ],
      cwd: workspace_path,
      // 启动参数由 runner 拥有，禁止继承父进程的 Node 注入选项。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
      windowsHide: true,
      stdio: ["ignore", stdout.fd, stderr.fd, "ipc"],
    };

    const process_result = await this.run_process(
      path.resolve(workspace_path, request.scriptPath),
      request.todos,
      launch_options,
      signal,
    );
    const execution: AgentWorkspaceExecution = {
      scriptPath: request.scriptPath,
      exitCode: process_result.exitCode,
      signal: process_result.signal,
      stdout: read_output(workspace_path, request.stdoutPath),
      stderr: read_output(workspace_path, request.stderrPath),
    };
    if (process_result.failure !== undefined)
      throw new AgentWorkspaceRunError(process_result.failure, execution);
    return { execution, todos: process_result.todos };
  }

  /** 子进程直接写入日志文件。父进程只处理 IPC 和生命周期，close 后再读取结果。 */
  private run_process(
    script_path: string,
    initial_todos: readonly string[],
    launch_options: ForkOptions,
    signal: AbortSignal,
  ): Promise<WorkspaceProcessResult> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = fork(script_path, [], launch_options);
      const proxy_requests = new Map<number, AbortController>();
      let todos = [...initial_todos]; // 只有正常退出才提交最后一份有效 Todo
      let terminal_error: unknown; // 首个终止原因拥有结果，close 只负责回收与结算
      const timeout_error = new Error("Workspace program timed out.");

      /** 终止当前进程时取消宿主等待，迟到响应不再投递。 */
      const abort_proxy_requests = (reason: unknown): void => {
        for (const controller of proxy_requests.values()) controller.abort(reason);
        proxy_requests.clear();
      };
      /** 所有强制终止路径共用一次回收；输出等 close 后收齐。 */
      const terminate = (reason: unknown): void => {
        if (terminal_error !== undefined) return;
        terminal_error = reason;
        abort_proxy_requests(reason);
        child.kill("SIGKILL");
      };
      /** IPC 发送失败沿同一终止路径处理。 */
      const send = (message: AgentWorkspaceRuntimeParentMessage): void => {
        if (!child.connected || terminal_error !== undefined) return;
        child.send(message, (error) => {
          if (error !== null) terminate(error);
        });
      };
      /** 每个代理请求独立关联响应和取消状态。 */
      const handle_proxy_request = (id: number, url: string): void => {
        if (proxy_requests.has(id)) throw new Error("Workspace runtime reused a proxy request id.");
        const controller = new AbortController();
        proxy_requests.set(id, controller);
        void this.system_proxy_resolver.resolveProxy(url, controller.signal).then(
          (rules) => {
            if (proxy_requests.get(id) !== controller) return;
            proxy_requests.delete(id);
            send({ type: "proxy_result", id, result: { ok: true, rules } });
          },
          (error: unknown) => {
            if (proxy_requests.get(id) !== controller) return;
            proxy_requests.delete(id);
            send({
              type: "proxy_result",
              id,
              result: {
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              },
            });
          },
        );
      };
      const abort_listener = (): void => terminate(signal.reason);
      const timer = setTimeout(
        () => terminate(timeout_error),
        AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs,
      );
      signal.addEventListener("abort", abort_listener, { once: true });
      child.on("message", (message: AgentWorkspaceRuntimeChildMessage) => {
        if (terminal_error !== undefined) return;
        try {
          switch (message.type) {
            case "proxy_request":
              handle_proxy_request(message.id, message.url);
              break;
            case "proxy_cancel":
              proxy_requests.get(message.id)?.abort(new Error("Proxy resolution was cancelled."));
              proxy_requests.delete(message.id);
              break;
            case "todos":
              todos = normalize_agent_todos(message.todos);
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
        clearTimeout(timer);
        signal.removeEventListener("abort", abort_listener);
        abort_proxy_requests(new Error("Workspace process closed."));
        if (terminal_error !== undefined && terminal_error !== timeout_error)
          reject(terminal_error);
        else
          resolve({
            exitCode,
            signal: exitSignal ?? null,
            todos,
            failure:
              terminal_error === timeout_error
                ? timeout_error.message
                : exitCode !== 0
                  ? "Workspace program exited unsuccessfully."
                  : undefined,
          });
      });
      send({ type: "start", todos });
      if (signal.aborted) abort_listener();
    });
  }
}

/** 只把额度内的完整文件读入内存，两路输出独立决定是否直接返回。 */
function read_output(workspace_path: string, relative_path: string): AgentWorkspaceOutput {
  const file_path = path.join(workspace_path, relative_path);
  const bytes = default_native_fs.stat(file_path).size;
  if (bytes > AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes) {
    return { path: relative_path, bytes, message: "输出超长，请按需读取记录文件。" };
  }
  const text = default_native_fs.read_text_file(file_path);
  let content: AgentWorkspaceOutputContent = text;
  try {
    const value = JSON.parse(text) as JsonValue;
    if (is_json_record(value) || Array.isArray(value)) content = value;
  } catch {
    // 普通文本和混合日志都是有效输出，保留原始内容。
  }
  return { path: relative_path, bytes, content };
}
