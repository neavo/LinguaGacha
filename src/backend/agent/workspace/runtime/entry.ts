import { is_json_record, type JsonRecord } from "../../../../domain/json";
import { execute_agent_workspace_script, type AgentWorkspaceRuntimeResponse } from "./execute";
import type { AgentWorkspaceReadPort } from "./tool/data-tool";
import {
  read_agent_workspace_runtime_parent_message,
  type AgentWorkspaceRuntimeChildMessage,
  type AgentWorkspaceRuntimeParentMessage,
} from "./protocol";
import { AgentWorkspaceProxyChannel, install_agent_workspace_proxy_fetch } from "./proxy-fetch";

type DenoFile = { readonly readable: ReadableStream<Uint8Array> };
type DenoGlobal = {
  open: (path: string, options: { read: true }) => Promise<DenoFile>;
  readTextFile: (path: string) => Promise<string>;
  stdin: { readonly readable: ReadableStream<Uint8Array> };
  stdout: { write: (data: Uint8Array) => Promise<number> };
  stderr: { write: (data: Uint8Array) => Promise<number> };
};

const deno = (globalThis as typeof globalThis & { Deno: DenoGlobal }).Deno; // 入口唯一的 Deno 宿主能力
const encoder = new TextEncoder(); // 控制协议与诊断流统一使用 UTF-8

void run_runtime_entry();

/** 启动消息、代理 RPC、脚本执行与完成信封只在此入口汇合。 */
async function run_runtime_entry(): Promise<void> {
  redirect_console_to_stderr();
  const messages = iterate_parent_messages()[Symbol.asyncIterator]();
  const first = await messages.next();
  if (first.done || first.value.type !== "start") {
    throw new Error("Workspace runtime did not receive its start message.");
  }
  const write_message = create_protocol_writer();
  const proxy_channel = new AgentWorkspaceProxyChannel(write_message);
  const receive_messages = receive_proxy_messages(messages, proxy_channel);
  const restore_fetch = install_agent_workspace_proxy_fetch(proxy_channel);
  let response: AgentWorkspaceRuntimeResponse;
  try {
    const contract_value = JSON.parse(await deno.readTextFile("contract.json")) as unknown;
    if (!is_json_record(contract_value)) throw new Error("Workspace contract is invalid.");
    const read_port: AgentWorkspaceReadPort = {
      contract: contract_value,
      iterateJsonl: iterate_jsonl,
    };
    response = await Promise.race([
      execute_agent_workspace_script(first.value.script, read_port, first.value.todos),
      receive_messages.then(() => {
        throw new Error("Workspace runtime parent channel closed before completion.");
      }),
    ]);
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : "Workspace runtime failed.",
    };
  } finally {
    restore_fetch();
  }
  await write_message({ type: "complete", response });
  proxy_channel.close(new Error("Workspace runtime completed."));
  await receive_messages.catch(() => undefined);
}

/** stdin 按 JSONL 持续接收启动请求与代理结果。 */
async function* iterate_parent_messages(): AsyncGenerator<AgentWorkspaceRuntimeParentMessage> {
  for await (const line of iterate_text_lines(deno.stdin.readable)) {
    if (line.trim() === "") continue;
    yield read_agent_workspace_runtime_parent_message(JSON.parse(line) as unknown);
  }
}

/** 后续父进程消息全部属于活动代理通道。 */
async function receive_proxy_messages(
  messages: AsyncIterator<AgentWorkspaceRuntimeParentMessage>,
  channel: AgentWorkspaceProxyChannel,
): Promise<void> {
  while (true) {
    const next = await messages.next();
    if (next.done) return;
    channel.accept(next.value);
  }
}

/** stdout 写入串行化，避免并发代理请求与完成信封交叉字节。 */
function create_protocol_writer(): (message: AgentWorkspaceRuntimeChildMessage) => Promise<void> {
  let pending = Promise.resolve();
  return async (message) => {
    const encoded = encoder.encode(`${JSON.stringify(message)}\n`);
    pending = pending.then(async () => await write_all(deno.stdout, encoded));
    await pending;
  };
}

/** Deno Writer 允许部分写入，循环直至完整消息进入 stdout。 */
async function write_all(
  writer: { write: (data: Uint8Array) => Promise<number> },
  data: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < data.byteLength) offset += await writer.write(data.subarray(offset));
}

/** Deno FsFile 的 readable 完成时自动关闭句柄；逐块解析避免物化完整 JSONL。 */
async function* iterate_jsonl(file_path: string): AsyncIterable<JsonRecord> {
  const file = await deno.open(file_path, { read: true });
  for await (const line of iterate_text_lines(file.readable)) {
    if (line.trim() !== "") yield parse_jsonl_record(line, file_path);
  }
}

/** UTF-8 JSONL 同时服务控制通道与 Workspace 数据集。 */
async function* iterate_text_lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        yield buffered.slice(0, newline).replace(/\r$/u, "");
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
      }
    }
    buffered += decoder.decode();
    if (buffered !== "") yield buffered.replace(/\r$/u, "");
  } finally {
    reader.releaseLock();
  }
}

/** Workspace JSONL 数据集只接收普通对象行。 */
function parse_jsonl_record(line: string, file_path: string): JsonRecord {
  const value = JSON.parse(line) as unknown;
  if (!is_json_record(value)) throw new Error(`Workspace JSONL entry is invalid: ${file_path}`);
  return value;
}

/** 用户脚本日志进入诊断流，stdout 始终只承载协议消息。 */
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
