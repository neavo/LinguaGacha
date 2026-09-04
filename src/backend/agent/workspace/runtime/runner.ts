import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";

import { is_json_record, type JsonValue } from "../../../../domain/json";
import { default_native_fs } from "../../../../native/native-fs";
import { normalize_agent_todos } from "../../../../shared/agent-todo";
import deno_runtime_manifest from "../../../../../buildtools/builder/deno-runtime-manifest.json";
import {
  resolve_system_proxy_route,
  type SystemProxyResolver,
  type SystemProxyRoute,
} from "../../../network/system-proxy-http-client";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";
import {
  read_agent_workspace_runtime_child_message,
  type AgentWorkspaceRuntimeParentMessage,
} from "./protocol";

const INITIALIZE_TIMEOUT_MS = 15_000; // 启动探测不能长期阻塞 GUI Backend ready
const DENO_VERSION_OUTPUT_BYTES = 16 * 1024; // 版本输出只应包含少量运行时元数据
const STDERR_TAIL_BYTES = 32 * 1024; // 仅保留有界诊断，避免脚本日志撑高 Backend 内存
const PROXY_ENV_KEYS = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]); // 代理事实只来自 Electron

export type AgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  script: string;
  todos: readonly string[];
}>;

export type AgentWorkspaceRunResult = Readonly<{ result: JsonValue; todos: string[] }>;

type WorkspaceProcessResult = { code: number | null; response: unknown; stderr: Buffer };

/** runtime 明确返回的可修复脚本错误，与进程或协议故障分开投影。 */
export class AgentWorkspaceScriptError extends Error {}

/** Backend Runtime 内唯一的 Deno 子进程执行器。 */
export class DenoAgentWorkspaceRunner {
  private readonly executable_path: string;
  private readonly runtime_entry_path: string;
  private readonly system_proxy_resolver: SystemProxyResolver;

  /** 固定解析资产路径；联网脚本的每次 fetch 通过同一 Electron 代理解析端口选路。 */
  public constructor(options: {
    executablePath: string;
    runtimeEntryPath: string;
    systemProxyResolver: SystemProxyResolver;
  }) {
    this.executable_path = path.resolve(options.executablePath);
    this.runtime_entry_path = path.resolve(options.runtimeEntryPath);
    this.system_proxy_resolver = options.systemProxyResolver;
  }

  /** 启动前验证固定文件与精确 Deno 版本，失败直接阻止 GUI Backend ready。 */
  public async initialize(): Promise<void> {
    assert_regular_file(this.executable_path, "Deno executable");
    assert_regular_file(this.runtime_entry_path, "Agent Workspace runtime entry");
    const stdout = await read_deno_version(this.executable_path);
    const first_line = stdout.split(/\r?\n/u, 1)[0]?.trim();
    if (first_line?.match(/^deno\s+([^\s]+)/u)?.[1] !== deno_runtime_manifest.version) {
      throw new Error(
        `Deno ${deno_runtime_manifest.version} is required; received ${first_line ?? "no version"}.`,
      );
    }
  }

  /** 每次脚本启动一次 Deno；代理 RPC 与最终结果共享流式 JSONL 控制通道。 */
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
      args: [
        "run",
        "--quiet",
        "--no-prompt",
        "--no-config",
        "--no-lock",
        ...AGENT_WORKSPACE_RUNTIME_POLICY.denoArgs,
        `--allow-read=${workspace_path}`,
        `--allow-write=${write_paths.join(",")}`,
        this.runtime_entry_path,
      ],
      cwd: workspace_path,
      start: {
        type: "start",
        script: request.script,
        todos: normalize_agent_todos(request.todos),
      },
      resolveProxy: async (url, proxy_signal) =>
        await resolve_system_proxy_route(this.system_proxy_resolver, url, proxy_signal),
      timeoutMs: AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs,
      signal,
    });
    if (result.code !== 0) {
      throw runtime_failure("Agent Workspace runtime exited unsuccessfully.", result.stderr);
    }
    const envelope = result.response;
    if (!is_json_record(envelope) || typeof envelope["ok"] !== "boolean") {
      throw runtime_failure("Agent Workspace runtime returned an invalid response.", result.stderr);
    }
    if (envelope["ok"] === false) {
      if (Object.keys(envelope).length !== 2 || typeof envelope["message"] !== "string") {
        throw runtime_failure(
          "Agent Workspace runtime returned an invalid error response.",
          result.stderr,
        );
      }
      throw new AgentWorkspaceScriptError(
        safe_error_message(envelope["message"], workspace_path),
        result.stderr.length === 0
          ? undefined
          : { cause: new Error(result.stderr.toString("utf8")) },
      );
    }
    if (Object.keys(envelope).length !== 3 || !("result" in envelope) || !("todos" in envelope)) {
      throw runtime_failure(
        "Agent Workspace runtime returned an invalid success response.",
        result.stderr,
      );
    }
    let todos: string[];
    try {
      todos = normalize_agent_todos(envelope["todos"]);
    } catch (cause) {
      throw runtime_failure("Agent Workspace runtime returned invalid Todo.", result.stderr, cause);
    }
    return { result: envelope["result"] as JsonValue, todos };
  }
}

/** initialize 只接受已落盘的普通文件资产。 */
function assert_regular_file(file_path: string, label: string): void {
  let stat;
  try {
    stat = default_native_fs.stat(file_path);
  } catch (cause) {
    throw new Error(`${label} is missing: ${file_path}.`, { cause });
  }
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file_path}.`);
}

/** 脚本协议逐行消费，不把代理请求与最终结果累计为一份 stdout。 */
function run_workspace_process(options: {
  executablePath: string;
  args: string[];
  cwd: string;
  start: AgentWorkspaceRuntimeParentMessage;
  resolveProxy: (url: string, signal: AbortSignal) => Promise<SystemProxyRoute>;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<WorkspaceProcessResult> {
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.executablePath, options.args, {
        cwd: options.cwd,
        env: build_workspace_runtime_env(process.env),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout_lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const proxy_requests = new Map<number, AbortController>();
    let response: unknown;
    let stderr_tail = Buffer.alloc(0);
    let terminal_error: unknown;
    let termination_reason: unknown;
    let settled = false;

    const terminate = (reason: unknown): void => {
      if (termination_reason !== undefined) return;
      termination_reason = reason;
      child.kill();
    };
    const abort_all_proxy_requests = (reason: unknown): void => {
      for (const controller of proxy_requests.values()) controller.abort(reason);
      proxy_requests.clear();
    };
    const write_message = (message: AgentWorkspaceRuntimeParentMessage): void => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };
    const handle_proxy_request = (id: number, url: string): void => {
      if (proxy_requests.has(id)) {
        terminate(new Error("Agent Workspace runtime reused a proxy request id."));
        return;
      }
      const controller = new AbortController();
      proxy_requests.set(id, controller);
      void options.resolveProxy(url, controller.signal).then(
        (route) => {
          if (proxy_requests.get(id) !== controller) return;
          proxy_requests.delete(id);
          write_message({ type: "proxy_result", id, result: { ok: true, route } });
        },
        (error: unknown) => {
          if (proxy_requests.get(id) !== controller) return;
          proxy_requests.delete(id);
          write_message({
            type: "proxy_result",
            id,
            result: { ok: false, message: error_message(error) },
          });
        },
      );
    };
    const abort_listener = (): void => terminate(options.signal.reason);
    const timer = setTimeout(
      () => terminate(new AgentWorkspaceScriptError("Agent Workspace script timed out.")),
      options.timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort_listener);
      stdout_lines.close();
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    options.signal.addEventListener("abort", abort_listener, { once: true });
    stdout_lines.on("line", (line) => {
      if (line.trim() === "") return;
      try {
        const message = read_agent_workspace_runtime_child_message(JSON.parse(line) as unknown);
        if (message.type === "proxy_request") {
          handle_proxy_request(message.id, message.url);
        } else if (message.type === "proxy_cancel") {
          proxy_requests.get(message.id)?.abort(new Error("Proxy resolution was cancelled."));
          proxy_requests.delete(message.id);
        } else {
          if (response !== undefined) {
            terminate(new Error("Agent Workspace runtime returned more than one result."));
            return;
          }
          response = message.response;
          abort_all_proxy_requests(new Error("Agent Workspace script completed."));
          child.stdin.end();
        }
      } catch (error) {
        terminate(error);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderr_tail = Buffer.concat([stderr_tail, value]);
      if (stderr_tail.length > STDERR_TAIL_BYTES) {
        stderr_tail = stderr_tail.subarray(stderr_tail.length - STDERR_TAIL_BYTES);
      }
    });
    child.stdin.once("error", (error) => {
      terminal_error = error;
      terminate(error);
    });
    child.once("error", (error) => {
      terminal_error = error;
    });
    child.once("close", (code) => {
      abort_all_proxy_requests(new Error("Agent Workspace runtime exited."));
      finish(() => {
        if (termination_reason !== undefined) reject(termination_reason);
        else if (terminal_error !== undefined) reject(terminal_error);
        else if (response === undefined) {
          reject(runtime_failure("Agent Workspace runtime returned no result.", stderr_tail));
        } else resolve({ code, response, stderr: stderr_tail });
      });
    });
    write_message(options.start);
    if (options.signal.aborted) abort_listener();
  });
}

/** Deno 网络只消费 Electron 显式返回的路线，不继承环境或 Windows 注册表代理。 */
function build_workspace_runtime_env(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(source).filter(([name]) => !PROXY_ENV_KEYS.has(name.toUpperCase())),
  );
  return {
    ...env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "",
  };
}

/** 版本探测交给 Node 的一次性进程 API 处理超时、输出上限与回收。 */
function read_deno_version(executable_path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable_path,
      ["--version"],
      {
        cwd: path.dirname(executable_path),
        encoding: "utf8",
        maxBuffer: DENO_VERSION_OUTPUT_BYTES,
        timeout: INITIALIZE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const diagnostic = stderr.trim();
          reject(
            new Error("Deno version check failed.", {
              cause: diagnostic === "" ? error : new Error(diagnostic, { cause: error }),
            }),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** 协议错误保留有界 stderr 作为本地 cause，不进入模型公开 message。 */
function runtime_failure(message: string, stderr: Buffer, cause?: unknown): Error {
  const diagnostic = stderr.toString("utf8").trim();
  const nested =
    diagnostic === "" ? cause : new Error(diagnostic, cause === undefined ? {} : { cause });
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

/** 代理解析异常需要跨 JSONL 返回，因此只保留可序列化正文。 */
function error_message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === "" ? "System proxy resolution failed." : message;
}
