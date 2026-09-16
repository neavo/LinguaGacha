import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import { is_json_record, type JsonRecord } from "../../../../domain/json";
import { iterate_utf8_lf_lines } from "../../../../shared/utils/text-tool";
import { SystemProxyHttpClient } from "../../../network/system-proxy-http-client";
import { create_agent_workspace_runtime_api } from "./api";
import type {
  AgentWorkspaceRuntimeParentMessage,
  AgentWorkspaceRuntimeChildMessage,
} from "./protocol";
import { AgentWorkspaceRequestChannel } from "./request-channel";

// --import 的顶层 await 保证宿主初始化完成后，Node 才开始执行真实程序入口。
const start = await new Promise<Extract<AgentWorkspaceRuntimeParentMessage, { type: "start" }>>(
  (resolve, reject) => {
    process.once("message", (message: AgentWorkspaceRuntimeParentMessage) => {
      if (message.type === "start") resolve(message);
      else reject(new Error("Workspace runtime did not receive a start message."));
    });
    // 父进程消失时立即回收程序，防止孤立进程继续修改工作材料。
    process.once("disconnect", () => process.exit(1));
  },
);
const request_channel = new AgentWorkspaceRequestChannel(send_message, (pending) => {
  // IPC 只在真正等待宿主响应时保活，空闲通道不得改变 Node 的自然退出语义。
  if (pending) process.channel?.ref();
  else process.channel?.unref();
});
process.on("message", (message: AgentWorkspaceRuntimeParentMessage) => {
  if (message.type === "response") request_channel.accept(message);
});
const client = new SystemProxyHttpClient(
  {
    resolveProxy: async (url, signal) => {
      const result = await request_channel.call({ kind: "resolve_proxy", url }, signal);
      if (typeof result !== "string") throw new Error("Invalid proxy response.");
      return result;
    },
  },
  { redirects: "request" },
);
client.install_as_global_fetch();
const contract: unknown = JSON.parse(await readFile("contract.json", "utf8"));
Object.defineProperty(globalThis, "ws", {
  value: create_agent_workspace_runtime_api(
    { contract, iterateJsonl: iterate_jsonl },
    start.todos,
    (todos) => {
      // send 自身负责刷新待发送消息；发送失败成为程序失败，不能提交未送达的 Todo。
      void send_message({ type: "todos", todos }).catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
    },
    async (request, signal) => {
      const result = await request_channel.call(request, signal);
      if (typeof result === "string" || result === null) throw new Error("Invalid host response.");
      return result;
    },
    async (path) => {
      await request_channel.call({ kind: "emit_image", path });
    },
  ),
});
process.channel?.unref();

/** 原生 IPC 交换应用状态、图片输出与宿主请求，程序文本走标准流。 */
function send_message(message: AgentWorkspaceRuntimeChildMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined || !process.connected) {
      reject(new Error("Workspace runtime parent channel is closed."));
      return;
    }
    process.send(message, (error) => (error === null ? resolve() : reject(error)));
  });
}

/** 按行读取快照，提前结束迭代时也关闭文件。 */
async function* iterate_jsonl(file_path: string): AsyncIterable<JsonRecord> {
  const stream = createReadStream(file_path);
  try {
    for await (const line of iterate_utf8_lf_lines(stream)) {
      if (line.trim() === "") continue;
      const value: unknown = JSON.parse(line);
      if (!is_json_record(value)) throw new Error(`Workspace JSONL entry is invalid: ${file_path}`);
      yield value;
    }
  } finally {
    stream.destroy();
  }
}
