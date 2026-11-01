import { bind_emit_image } from "../../tools/emit-image";
import { bind_doing } from "../../tools/doing";
import { bind_host } from "../../tools/host";
import { bind_python } from "../../python/runtime";
import { readFile } from "node:fs/promises";
import { install_workspace_module_resolution } from "./module-resolution";

import { ProxyHttpClient } from "../../../network/proxy-http-client";
import { create_agent_workspace_runtime_api } from "./api";
import {
  AGENT_WORKSPACE_ENTRY_ENV,
  type AgentWorkspaceRuntimeParentMessage,
  type AgentWorkspaceRuntimeChildMessage,
} from "./protocol";
import { AgentWorkspaceRequestChannel } from "./request-channel";

// 脚本 fork 的子进程和 worker 会继承 --import。标记只属于 runner 启动的根进程，读取后立即移除，后代据此作为标准 Node 运行。
const entry = process.env[AGENT_WORKSPACE_ENTRY_ENV] === "1";
delete process.env[AGENT_WORKSPACE_ENTRY_ENV];
// --import 的顶层 await 保证宿主初始化完成后，Node 才开始执行真实程序入口。
if (entry) await start_workspace_runtime();

/** 等待宿主 start，再安装模块解析、宿主通道、代理与 `ws`。 */
async function start_workspace_runtime(): Promise<void> {
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
  install_workspace_module_resolution(start.runtimeDirectory, start.nodeRoot, start.moduleRoots);
  bind_python(start.python);
  const request_channel = new AgentWorkspaceRequestChannel(send_message, (pending) => {
    // IPC 只在真正等待宿主响应时保活，空闲通道不得改变 Node 的自然退出语义。
    if (pending) process.channel?.ref();
    else process.channel?.unref();
  });
  process.on("message", (message: AgentWorkspaceRuntimeParentMessage) => {
    if (message.type === "response") request_channel.accept(message);
  });
  const client = new ProxyHttpClient(
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
    value: create_agent_workspace_runtime_api(contract, start.userSkillDirectory, {
      host: bind_host(request_channel),
      emitImage: bind_emit_image(request_channel),
      doing: bind_doing(request_channel),
    }),
  });
  process.channel?.unref();
}

/** 原生 IPC 交换图片输出与宿主请求，程序文本走标准流。 */
function send_message(message: AgentWorkspaceRuntimeChildMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined || !process.connected) {
      reject(new Error("Workspace runtime parent channel is closed."));
      return;
    }
    process.send(message, (error) => (error === null ? resolve() : reject(error)));
  });
}
