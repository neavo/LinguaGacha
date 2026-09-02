import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { is_json_record, type JsonValue } from "../../../domain/json";
import { default_native_fs } from "../../../native/native-fs";
import deno_runtime_manifest from "../../../../buildtools/builder/deno-runtime-manifest.json";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./policy";

const INITIALIZE_TIMEOUT_MS = 15_000;
const STDERR_TAIL_BYTES = 32 * 1024;
const STDOUT_PROTOCOL_BYTES = AGENT_WORKSPACE_RUNTIME_POLICY.resultBytes + 8 * 1024;

export type AgentWorkspaceRunRequest = Readonly<{
  workspacePath: string;
  script: string;
}>;

type ProcessResult = { code: number | null; stdout: Buffer; stderr: Buffer };

/** runtime 明确返回的可修复脚本错误，与进程或协议故障分开投影。 */
export class AgentWorkspaceScriptError extends Error {}

/** Backend Runtime 内唯一的 Deno 子进程执行器。 */
export class DenoAgentWorkspaceRunner {
  private readonly executable_path: string;
  private readonly runtime_entry_path: string;

  /** 固定解析路径，后续权限参数不接受调用方提供的相对资产位置。 */
  public constructor(options: { executablePath: string; runtimeEntryPath: string }) {
    this.executable_path = path.resolve(options.executablePath);
    this.runtime_entry_path = path.resolve(options.runtimeEntryPath);
  }

  /** 启动前验证固定文件与精确 Deno 版本，失败直接阻止 GUI Backend ready。 */
  public async initialize(): Promise<void> {
    assert_regular_file(this.executable_path, "Deno executable");
    assert_regular_file(this.runtime_entry_path, "Agent Workspace runtime entry");
    const result = await run_child_process({
      executablePath: this.executable_path,
      args: ["--version"],
      cwd: path.dirname(this.executable_path),
      stdin: null,
      timeoutMs: INITIALIZE_TIMEOUT_MS,
      stdoutLimit: 16 * 1024,
    });
    if (result.code !== 0) {
      throw runtime_failure("Deno version check failed.", result.stderr);
    }
    const first_line = result.stdout.toString("utf8").split(/\r?\n/u, 1)[0]?.trim();
    if (first_line?.match(/^deno\s+([^\s]+)/u)?.[1] !== deno_runtime_manifest.version) {
      throw new Error(
        `Deno ${deno_runtime_manifest.version} is required; received ${first_line ?? "no version"}.`,
      );
    }
  }

  /** 每次脚本启动一次 Deno；文件写入直接落入受限真实 Workspace。 */
  public async run(request: AgentWorkspaceRunRequest, signal: AbortSignal): Promise<JsonValue> {
    signal.throwIfAborted();
    const workspace_path = path.resolve(request.workspacePath);
    const write_paths = AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots.map((name) =>
      path.join(workspace_path, name),
    );
    const args = [
      "run",
      "--quiet",
      "--no-prompt",
      "--no-config",
      "--no-lock",
      ...AGENT_WORKSPACE_RUNTIME_POLICY.denoRestrictionArgs,
      `--allow-read=${workspace_path}`,
      `--allow-write=${write_paths.join(",")}`,
      this.runtime_entry_path,
    ];
    const result = await run_child_process({
      executablePath: this.executable_path,
      args,
      cwd: workspace_path,
      stdin: Buffer.from(JSON.stringify({ script: request.script }), "utf8"),
      timeoutMs: AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs,
      stdoutLimit: STDOUT_PROTOCOL_BYTES,
      signal,
    });
    if (result.code !== 0) {
      throw runtime_failure("Agent Workspace runtime exited unsuccessfully.", result.stderr);
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(result.stdout.toString("utf8")) as unknown;
    } catch (cause) {
      throw runtime_failure("Agent Workspace runtime returned invalid JSON.", result.stderr, cause);
    }
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
    if (Object.keys(envelope).length !== 2 || !("result" in envelope)) {
      throw runtime_failure(
        "Agent Workspace runtime returned an invalid success response.",
        result.stderr,
      );
    }
    return envelope["result"] as JsonValue;
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

/** 子进程输出、取消和超时统一在 close 后结算，避免工作区仍有活跃写入。 */
function run_child_process(options: {
  executablePath: string;
  args: string[];
  cwd: string;
  stdin: Buffer | null;
  timeoutMs: number;
  stdoutLimit: number;
  signal?: AbortSignal;
}): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.executablePath, options.args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout_chunks: Buffer[] = [];
    let stdout_bytes = 0;
    let stderr_tail = Buffer.alloc(0);
    let terminal_error: unknown;
    let termination_reason: unknown;
    let settled = false;

    const terminate = (reason: unknown): void => {
      if (termination_reason !== undefined) return;
      termination_reason = reason;
      child.kill();
    };
    const abort_listener = (): void => terminate(options.signal?.reason);
    const timer = setTimeout(
      () => terminate(new AgentWorkspaceScriptError("Agent Workspace script timed out.")),
      options.timeoutMs,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort_listener);
    };
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    options.signal?.addEventListener("abort", abort_listener, { once: true });
    child.stdout.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdout_bytes += value.length;
      if (stdout_bytes > options.stdoutLimit) {
        terminate(new AgentWorkspaceScriptError("Agent Workspace protocol output is too large."));
        return;
      }
      stdout_chunks.push(value);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderr_tail = Buffer.concat([stderr_tail, value]);
      if (stderr_tail.length > STDERR_TAIL_BYTES) {
        stderr_tail = stderr_tail.subarray(stderr_tail.length - STDERR_TAIL_BYTES);
      }
    });
    child.once("error", (error) => {
      terminal_error = error;
    });
    child.once("close", (code) => {
      finish(() => {
        if (termination_reason !== undefined) reject(termination_reason);
        else if (terminal_error !== undefined) reject(terminal_error);
        else resolve({ code, stdout: Buffer.concat(stdout_chunks), stderr: stderr_tail });
      });
    });
    if (options.stdin === null) child.stdin.end();
    else child.stdin.end(options.stdin);
    if (options.signal?.aborted) abort_listener();
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
