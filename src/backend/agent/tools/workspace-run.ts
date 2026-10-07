import { summarize_images } from "./emit-image";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import {
  define_agent_tool,
  agent_tool_result,
  normalize_agent_tool_error,
  AgentToolError,
} from "../tool-definition";
import { AGENT_WORKSPACE_CONTRACT } from "./contract";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
} from "../workspace/runtime/policy";
import { format_agent_workspace_typescript_api } from "../workspace/runtime/api-description";
import type { AgentWorkspacePort } from "../workspace/service";
import app_package from "../../../../package.json";

/** 执行程序并刷新技能事实，随后投影模型可见的执行记录与图片。 */
export function create_agent_workspace_run_tool(options: {
  run: (script: string, signal: AbortSignal) => ReturnType<AgentWorkspacePort["run"]>;
  refresh_skills: () => Promise<unknown>;
}): ToolRegistration {
  return define_agent_tool({
    name: "workspace_run",
    description: [
      "在工程工作区运行脚本，读取工程事实、处理文件和准备变更清单，执行时自动刷新工程快照。",
      "",
      "### 工作方式",
      "",
      "- 每次调用启动独立 Node.js 进程，跨调用的数据通过文件交接。",
      `- 脚本保存到 ${AGENT_WORKSPACE_RUN_ROOT}/*.mjs`,
      "- 当前工作目录（`cwd`）是工作区根目录，文件相对路径从这里解析，脚本内的相对 `import` 从脚本文件所在目录解析。",
      `- 预装包：${app_package.workspacePackages.join("、")}，通过标准 import 使用。`,
      "  - `@lg/workspace/item-contexts` 提供 `queryItemContexts`，用于取得条目的邻近语境。调用约定见导出函数注释，可用 `readFile(new URL(import.meta.resolve('@lg/workspace/item-contexts')), 'utf8')` 读取模块。",
      "  - `@lg/text` 提供与应用共用的字面匹配能力。",
      "  - `@lg/pdf` 提供与正式输出共用的文档模板。",
      "- 包版本、类型和详细 API 可从 `node_modules` 中读取，依赖由应用管理，禁止自行安装或下载依赖。",
      "",
      "### 文件与权限",
      "",
      "- 可以读取整个工作区，包括 `node_modules` 中的预装包、类型声明和文档。",
      `- 可以写入 ${AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots.map((root) => `${root}/**`).join("、")}。目录链接沿入口权限使用。`,
      "- 禁止创建子进程、启动 worker 或加载原生扩展（native addons）。",
      "",
      "### 输出",
      "",
      `- 执行时限为 ${AGENT_WORKSPACE_RUNTIME_POLICY.timeoutMs / 1000} 秒。程序在事件循环空闲时自然退出。`,
      "- 按任务需要选择输出内容和格式，使用 `console.log` 输出结果。",
      `- 每次程序最多输出 ${AGENT_WORKSPACE_RUNTIME_POLICY.imageCount} 张图片，更多图片分到后续 workspace_run 调用。`,
      "- 每次执行都会保存 `stdout` 和 `stderr` 文件，无输出时文件为空。",
      `- 每路不超过 ${AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes / 1024} KiB 时直接返回完整内容。超额时返回文件路径和补读提示。请读取当前任务所需的部分。`,
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`scriptPath`|本次程序的工作区相对路径|",
      "|`exitCode`、`signal`|进程退出码与退出信号|",
      "|`stdout`、`stderr`|两路输出各自的文件信息|",
      "|`path`、`bytes`|文件的工作区相对路径与字节数|",
      "|`content` 或 `message`|直接返回的内容，或超额时的补读提示|",
      "",
      "### 失败与恢复",
      "",
      "- 程序失败或超时会携带执行记录，根据记录定位失败原因。",
      "- 程序失败、停止或超时后，已完成的文件写入仍然保留，继续前检查受影响的文件，复用完整内容并修复未完成或损坏的部分。",
      "",
      "### 工作区目录",
      "",
      ...Object.entries(AGENT_WORKSPACE_CONTRACT.datasets).map(([name, dataset]) => {
        const operations = Object.keys(AGENT_WORKSPACE_CONTRACT.changes[name] ?? {});
        return `- datasets.${name}：${dataset.purpose}。${operations.length === 0 ? "只读" : `变更入口 changes.${name}，操作 ${operations.join("、")}`}。参考 ${dataset.reference}。`;
      }),
      "",
      "### 示例",
      "",
      "`ws` 由运行环境预先提供，直接使用，无需导入，以下为示例：",
      "",
      "```js",
      'import { readFile } from "node:fs/promises";',
      "",
      'console.log(await readFile(ws.contract.changes.items.updates.reference, "utf8"));',
      "const path = ws.contract.datasets.project_meta.path;",
      'const meta = JSON.parse(await readFile(path, "utf8"));',
      "console.log(JSON.stringify(meta, null, 2));",
      "```",
      "",
      "以下 TypeScript 声明仅用于描述接口，脚本请使用 JavaScript 编写：",
      "```ts",
      format_agent_workspace_typescript_api(),
      "```",
    ].join("\n"),
    executionMode: "sequential",
    parameters: Type.Object(
      {
        script: Type.String({
          minLength: 1,
          description: "要执行的完整 JavaScript ESM 源码。",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (params, _api, context) => {
      const signal = context.abortSignal;
      // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
      const effective_signal = signal ?? new AbortController().signal;
      effective_signal.throwIfAborted();
      const outcome = await options.run(params.script, effective_signal).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // 程序失败时仍刷新已写入的技能，两者失败保留主回执与完整原因链。
      try {
        await options.refresh_skills();
      } catch (error) {
        if (outcome.ok) throw new Error("Agent skill refresh failed.", { cause: error });
        const failure = normalize_agent_tool_error(outcome.error);
        throw new AgentToolError(
          failure.details,
          new AggregateError(
            [outcome.error, error],
            "Workspace execution and skill refresh failed.",
          ),
          "fault",
        );
      }
      if (!outcome.ok) throw outcome.error;
      const { execution, images } = outcome.value;
      const result = agent_tool_result({
        ...execution,
        ...(images.length === 0
          ? {}
          : {
              images: summarize_images(images),
            }),
      });
      return {
        ...result,
        content: [
          ...result.content,
          ...images.map(({ image }) => ({
            type: "image" as const,
            mimeType: image.mimeType,
            data: image.data,
          })),
        ],
      };
    },
  });
}
