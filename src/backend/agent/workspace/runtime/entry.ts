import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import { is_json_record, type JsonRecord } from "../../../../domain/json";
import { iterate_utf8_lf_lines } from "../../../../shared/utils/text-tool";
import { SystemProxyHttpClient } from "../../../network/system-proxy-http-client";
import { execute_agent_workspace_script, type AgentWorkspaceRuntimeResponse } from "./execute";
import {
  type AgentWorkspaceRuntimeParentMessage,
  type AgentWorkspaceRuntimeChildMessage,
} from "./protocol";
import { AgentWorkspaceProxyChannel } from "./proxy-channel";

const proxy_channel = new AgentWorkspaceProxyChannel(send_message);
// 父进程消失时立即回收脚本，避免留下仍可写工作区的孤立进程。
process.once("disconnect", () => process.exit(1));
// 首条消息启动唯一脚本；后续消息只负责结算它发出的代理请求。
process.once("message", (message: AgentWorkspaceRuntimeParentMessage) => {
  if (message.type !== "start")
    throw new Error("Workspace runtime did not receive a start message.");
  process.on(
    "message",
    (reply: Extract<AgentWorkspaceRuntimeParentMessage, { type: "proxy_result" }>) =>
      proxy_channel.accept(reply),
  );
  void run_script(message.script, message.todos);
});

/** 一次性进程拥有 fetch 和所有文件句柄；完成回包发送成功后明确退出，结束遗留异步任务。 */
async function run_script(script: string, todos: readonly string[]): Promise<void> {
  let response: AgentWorkspaceRuntimeResponse;
  try {
    const client = new SystemProxyHttpClient(proxy_channel, { redirects: "request" });
    client.install_as_global_fetch();
    const contract = JSON.parse(await readFile("contract.json", "utf8")) as unknown;
    response = await execute_agent_workspace_script(
      script,
      { contract, iterateJsonl: iterate_jsonl },
      todos,
    );
  } catch (error) {
    response = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  try {
    await send_message({ type: "complete", response });
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

/** Node IPC 自行分帧；回调确认消息发送完成后才允许进程退出。 */
function send_message(message: AgentWorkspaceRuntimeChildMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined || !process.connected) {
      reject(new Error("Workspace runtime parent channel is closed."));
      return;
    }
    process.send(message, (error) => (error === null ? resolve() : reject(error)));
  });
}

/** 按行读取快照，提前结束迭代时也关闭文件；保持 JSONL 的 LF / CRLF 语义。 */
async function* iterate_jsonl(file_path: string): AsyncIterable<JsonRecord> {
  const stream = createReadStream(file_path);
  try {
    for await (const line of iterate_utf8_lf_lines(stream)) {
      if (line.trim() === "") continue;
      const value = JSON.parse(line) as unknown;
      if (!is_json_record(value)) throw new Error(`Workspace JSONL entry is invalid: ${file_path}`);
      yield value;
    }
  } finally {
    stream.destroy();
  }
}
