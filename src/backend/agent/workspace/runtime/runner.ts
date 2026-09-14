import { fork, type ForkOptions } from "node:child_process";
import path from "node:path";

import { is_json_record, type JsonValue } from "../../../../domain/json";
import { normalize_agent_todos } from "../../../../shared/agent-todo";
import type { SystemProxyResolver } from "../../../network/system-proxy-http-client";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import {
  type AgentWorkspaceRuntimeChildMessage,
  type AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

const DIAGNOSTIC_TAIL_BYTES = 32 * 1024; // stdout / stderr 共用有界诊断尾部，避免脚本日志撑高 Backend 内存

export type AgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  script: string;
  todos: readonly string[];
}>;

export type AgentWorkspaceRunResult = Readonly<{ result: JsonValue; todos: string[] }>;

type WorkspaceProcessResult = { code: number | null; response: unknown; diagnostic: Buffer };

/** runtime 明确返回的可修复脚本错误，与进程或协议故障分开投影。 */
export class AgentWorkspaceScriptError extends Error {}

/** Backend Runtime 内唯一的 Node 子进程执行器。 */
export class AgentWorkspaceRunner {
  private readonly executable_path: string;
  private readonly runtime_entry_path: string;
  private readonly system_proxy_resolver: SystemProxyResolver;

  /** 固定解析资产路径；联网脚本的每次 fetch 通过同一 Electron 代理解析端口选路。 */
  public constructor(options: {
    executablePath?: string; // 生产复用当前 Electron；真实运行时测试可指定 Electron 可执行文件
    runtimeEntryPath: string;
    systemProxyResolver: SystemProxyResolver;
  }) {
    this.executable_path = path.resolve(options.executablePath ?? process.execPath);
    this.runtime_entry_path = path.resolve(options.runtimeEntryPath);
    this.system_proxy_resolver = options.systemProxyResolver;
  }

  /** 每次调用使用独立进程；权限防止意外越界读写，结果经原生 IPC 返回。 */
  public async run(
    request: AgentWorkspaceRunRequest,
    signal: AbortSignal,
  ): Promise<AgentWorkspaceRunResult> {
    signal.throwIfAborted();
    const workspace_path = path.resolve(request.workspacePath);
    const write_paths = AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots.map((name) =>
      path.join(workspace_path, name),
    );
    const result = await run_workspace_process({
      executablePath: this.executable_path,
      runtimeEntryPath: this.runtime_entry_path,
      args: [
        "--permission",
        `--allow-fs-read=${workspace_path}`,
        `--allow-fs-read=${this.runtime_entry_path}`,
        ...write_paths.map((file_path) => `--allow-fs-write=${file_path}`),
      ],
      cwd: workspace_path,
      start: {
        type: "start",
        script: request.script,
        todos: normalize_agent_todos(request.todos),
      },
      resolveProxy: async (url, proxy_signal) =>
        await this.system_proxy_resolver.resolveProxy(url, proxy_signal),
      timeoutMs: AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs,
      signal,
    });
    if (result.code !== 0) {
      throw runtime_failure("Agent Workspace runtime exited unsuccessfully.", result.diagnostic);
    }
    const envelope = result.response;
    if (!is_json_record(envelope) || typeof envelope["ok"] !== "boolean") {
      throw runtime_failure(
        "Agent Workspace runtime returned an invalid response.",
        result.diagnostic,
      );
    }
    if (envelope["ok"] === false) {
      if (typeof envelope["message"] !== "string") {
        throw runtime_failure(
          "Agent Workspace runtime returned an invalid error response.",
          result.diagnostic,
        );
      }
      throw new AgentWorkspaceScriptError(
        safe_error_message(envelope["message"], workspace_path),
        result.diagnostic.length === 0
          ? undefined
          : { cause: new Error(result.diagnostic.toString("utf8")) },
      );
    }
    if (!("result" in envelope) || !("todos" in envelope)) {
      throw runtime_failure(
        "Agent Workspace runtime returned an invalid success response.",
        result.diagnostic,
      );
    }
    let todos: string[];
    try {
      todos = normalize_agent_todos(envelope["todos"]);
    } catch (cause) {
      throw runtime_failure(
        "Agent Workspace runtime returned invalid Todo.",
        result.diagnostic,
        cause,
      );
    }
    return { result: envelope["result"] as JsonValue, todos };
  }
}

/** 父进程拥有退出与取消；等待 close 后才允许 WorkspaceService 释放工作区互斥。 */
function run_workspace_process(options: {
  executablePath: string;
  runtimeEntryPath: string;
  args: string[];
  cwd: string;
  start: AgentWorkspaceRuntimeParentMessage;
  resolveProxy: (url: string, signal: AbortSignal) => Promise<string>;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<WorkspaceProcessResult> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // fork 将选项传给 spawn；Node 类型尚未包含 Windows 隐藏窗口选项。
    const launch_options: ForkOptions & { windowsHide: boolean } = {
      execPath: options.executablePath,
      execArgv: options.args,
      cwd: options.cwd,
      // 清除父进程的 Node 启动选项，权限参数由 runner 唯一拥有。
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    };
    const child = fork(options.runtimeEntryPath, [], launch_options);
    const proxy_requests = new Map<number, AbortController>(); // 每个请求独立取消，完成后立即移除
    let response: unknown; // 完成回包先暂存，close 才决定本次调用是否成功
    let diagnostic_tail = Buffer.alloc(0);
    let terminal_error: unknown; // 首个终止原因拥有失败结果，后续退出事件只负责回收

    /** 终止或完成时结束全部宿主等待，迟到回包由请求表丢弃。 */
    const abort_proxy_requests = (reason: unknown): void => {
      for (const controller of proxy_requests.values()) controller.abort(reason);
      proxy_requests.clear();
    };
    /** 强制结束仍可能占用事件循环的脚本；结果仍等 close 后结算。 */
    const terminate = (reason: unknown): void => {
      if (terminal_error !== undefined) return;
      terminal_error = reason;
      abort_proxy_requests(reason);
      child.kill("SIGKILL");
    };
    /** IPC 发送失败归入同一进程终止路径。 */
    const send = (message: AgentWorkspaceRuntimeParentMessage): void => {
      if (!child.connected || terminal_error !== undefined) return;
      child.send(message, (error) => {
        if (error !== null) terminate(error);
      });
    };
    /** 每个 ID 持有独立取消信号，宿主只返回规则文本。 */
    const handle_proxy_request = (id: number, url: string): void => {
      if (proxy_requests.has(id)) {
        terminate(new Error("Agent Workspace runtime reused a proxy request id."));
        return;
      }
      const controller = new AbortController();
      proxy_requests.set(id, controller);
      void options.resolveProxy(url, controller.signal).then(
        (rules) => {
          if (proxy_requests.get(id) !== controller) return;
          proxy_requests.delete(id);
          send({ type: "proxy_result", id, result: { ok: true, rules } });
        },
        (error: unknown) => {
          if (proxy_requests.get(id) !== controller) return;
          proxy_requests.delete(id);
          send({ type: "proxy_result", id, result: { ok: false, message: error_message(error) } });
        },
      );
    };
    const abort_listener = (): void => terminate(options.signal.reason);
    const timer = setTimeout(
      () => terminate(new AgentWorkspaceScriptError("Agent Workspace script timed out.")),
      options.timeoutMs,
    );
    options.signal.addEventListener("abort", abort_listener, { once: true });
    child.on("message", (message: AgentWorkspaceRuntimeChildMessage) => {
      if (terminal_error !== undefined) return;
      try {
        if (response !== undefined)
          throw new Error("Agent Workspace runtime sent a message after completion.");
        if (message.type === "proxy_request") handle_proxy_request(message.id, message.url);
        else if (message.type === "proxy_cancel") {
          proxy_requests.get(message.id)?.abort(new Error("Proxy resolution was cancelled."));
          proxy_requests.delete(message.id);
        } else {
          response = message.response;
          abort_proxy_requests(new Error("Agent Workspace script completed."));
        }
      } catch (error) {
        terminate(error);
      }
    });
    /** 只保留有界日志尾部，避免模型脚本的日志占满宿主内存。 */
    const collect_diagnostic = (chunk: Buffer): void => {
      diagnostic_tail = Buffer.concat([diagnostic_tail, chunk]).subarray(-DIAGNOSTIC_TAIL_BYTES);
    };
    child.stdout?.on("data", collect_diagnostic);
    child.stderr?.on("data", collect_diagnostic);
    child.once("error", terminate);
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort_listener);
      abort_proxy_requests(new Error("Agent Workspace runtime exited."));
      if (terminal_error !== undefined) reject(terminal_error);
      else if (response === undefined)
        reject(runtime_failure("Agent Workspace runtime returned no result.", diagnostic_tail));
      else resolve({ code, response, diagnostic: diagnostic_tail });
    });
    send(options.start);
    if (options.signal.aborted) abort_listener();
  });
}

/** 协议错误保留有界进程诊断 作为本地 cause，不进入模型公开 message。 */
function runtime_failure(message: string, diagnostic: Buffer, cause?: unknown): Error {
  const text = diagnostic.toString("utf8").trim();
  const nested = text === "" ? cause : new Error(text, cause === undefined ? {} : { cause });
  return new Error(message, nested === undefined ? undefined : { cause: nested });
}

/** 模型错误只保留一行并替换 Workspace 与其它绝对路径。 */
function safe_error_message(raw: string, workspace_path: string): string {
  const first_line = raw.split(/\r?\n/u, 1)[0]?.trim() ?? "";
  let result = first_line;
  for (const candidate of new Set([
    workspace_path,
    workspace_path.replaceAll("\\", "/"),
    workspace_path.replaceAll("/", "\\"),
  ])) {
    result = result.replaceAll(candidate, "[workspace]");
  }
  result = result.replace(/[A-Za-z]:[\\/][^\s]*/gu, "[path]");
  return (result === "" ? "工作区脚本执行失败。" : result).slice(0, 500);
}

/** 代理解析异常需要跨 IPC 返回，因此只保留可序列化正文。 */
function error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === "" ? "System proxy resolution failed." : message;
}
