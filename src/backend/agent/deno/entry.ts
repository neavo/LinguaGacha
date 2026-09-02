import { is_json_record, type JsonRecord } from "../../../domain/json";
import {
  execute_agent_workspace_script,
  read_agent_workspace_runtime_request,
  type AgentWorkspaceRuntimeResponse,
} from "./execute";
import type { AgentWorkspaceReadPort } from "./data";

type DenoFile = { readonly readable: ReadableStream<BufferSource> };
type DenoGlobal = {
  cwd: () => string;
  open: (path: string, options: { read: true }) => Promise<DenoFile>;
  readTextFile: (path: string) => Promise<string>;
  stdin: { readonly readable: ReadableStream<Uint8Array> };
  stdout: { write: (data: Uint8Array) => Promise<number> };
  stderr: { write: (data: Uint8Array) => Promise<number> };
};

const deno = (globalThis as typeof globalThis & { Deno: DenoGlobal }).Deno;
const encoder = new TextEncoder();

void run_runtime_entry();

/** stdin、工作区 contract、脚本执行与 stdout envelope 只在此入口汇合。 */
async function run_runtime_entry(): Promise<void> {
  let response: AgentWorkspaceRuntimeResponse;
  try {
    redirect_console_to_stderr();
    const request_text = await new Response(deno.stdin.readable).text();
    const request = read_agent_workspace_runtime_request(JSON.parse(request_text) as unknown);
    const contract_value = JSON.parse(await deno.readTextFile("contract.json")) as unknown;
    if (!is_json_record(contract_value)) throw new Error("Workspace contract is invalid.");
    const read_port: AgentWorkspaceReadPort = {
      contract: contract_value,
      iterateJsonl: iterate_jsonl,
    };
    response = await execute_agent_workspace_script(request.script, read_port);
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : "Workspace runtime failed.",
    };
  }
  await deno.stdout.write(encoder.encode(JSON.stringify(response)));
}

/** Deno FsFile 的 readable 完成时自动关闭句柄；逐块解析避免物化完整 JSONL。 */
async function* iterate_jsonl(file_path: string): AsyncIterable<JsonRecord> {
  const file = await deno.open(file_path, { read: true });
  const reader = file.readable.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += value;
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline).replace(/\r$/u, "");
        buffered = buffered.slice(newline + 1);
        if (line.trim() !== "") yield parse_jsonl_record(line, file_path);
        newline = buffered.indexOf("\n");
      }
    }
    if (buffered.trim() !== "") yield parse_jsonl_record(buffered.replace(/\r$/u, ""), file_path);
  } finally {
    reader.releaseLock();
  }
}

/** JSONL 领域方法只接收普通对象行。 */
function parse_jsonl_record(line: string, file_path: string): JsonRecord {
  const value = JSON.parse(line) as unknown;
  if (!is_json_record(value)) throw new Error(`Workspace JSONL entry is invalid: ${file_path}`);
  return value;
}

/** 用户脚本日志进入诊断流，stdout 始终只承载协议 envelope。 */
function redirect_console_to_stderr(): void {
  const write = (...values: unknown[]): void => {
    const line = `${values.map(format_console_value).join(" ")}\n`;
    void deno.stderr.write(encoder.encode(line));
  };
  console.log = write;
  console.info = write;
  console.debug = write;
  console.warn = write;
  console.error = write;
}

/** 字符串保持原样，其余日志值尽量投影为单行 JSON。 */
function format_console_value(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
