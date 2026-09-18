import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { AgentApprovalMode, AgentPendingWriteSummary } from "../../../shared/agent";
import { agent_tool_result } from "./definition";
import { AGENT_WORKSPACE_CONTRACT } from "../workspace/contract";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
} from "../workspace/runtime/policy";
import { format_agent_workspace_typescript_api } from "../workspace/runtime/api-description";
import type { AgentWorkspacePort } from "../workspace/service";
import app_package from "../../../../package.json";

/** AgentService 提供的窄审批端口，工作区服务不感知会话或 UI 状态。 */
export type AgentWorkspaceApprovalPort = {
  read_mode: () => AgentApprovalMode;
  wait_for_decision: (
    tool_call_id: string,
    summary: AgentPendingWriteSummary,
    signal: AbortSignal | undefined,
  ) => Promise<{ auto_revision: number | null }>;
  activate_auto: (mode_revision: number) => void;
};

/** AgentService 持有跨回合 Todo，脚本工具只协调调用前后的不可变快照。 */
export type AgentTodoPort = {
  read: () => string[];
  write: (todos: readonly string[]) => void;
};

/** 参数只描述脚本输入；环境和完整 API 随工具说明公开。 */
const WORKSPACE_RUN_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description: "要执行的完整 JavaScript ESM 源码。",
    }),
  },
  { additionalProperties: false },
);

/** 运行限制从真实策略生成，声明从工具 Schema 生成。 */
const WORKSPACE_RUN_DESCRIPTION: string = [
  "在工程工作区运行脚本，用于读取工程事实、处理文件和准备变更清单，工具按需自动刷新工程快照。",
  "",
  "### 工作方式",
  "",
  "- 每次调用启动独立 Node.js 进程，跨调用的数据通过文件交接。",
  `- 脚本保存到 ${AGENT_WORKSPACE_RUN_ROOT}/*.mjs`,
  "- 当前工作目录（`cwd`）是工作区根目录，文件相对路径从这里解析。脚本内的相对 `import` 从脚本文件所在目录解析。",
  "- `ws.contract` 提供数据集、变更路径、参考入口与通用提交规则。先读取目标的 `reference`，了解记录结构、修改格式和副作用。会话内复用已读说明。",
  "- `read_skill` 或显式技能注入提供原包根目录的 `base_url`。用 `await import(new URL('scripts/example.mjs', base_url).href)` 加载技能脚本。",
  "- `ws.host` 提供宿主基础能力，复杂流程可参考技能中的示例或脚本。`@lg/pdf` 提供与正式输出共用的文档模板。",
  `- 预装包：${app_package.workspacePackages.join("、")}，通过标准 import 使用。`,
  "- `@lg/workspace/item-contexts` 提供 `queryItemContexts`，用于取得条目的邻近语境。调用约定见导出函数注释，可用 `readFile(new URL(import.meta.resolve('@lg/workspace/item-contexts')), 'utf8')` 读取模块。",
  "- `@lg/text` 提供与应用共用的字面匹配能力，具体用法见领域技能。",
  "- 包版本、类型和详细 API 可从 `node_modules` 中读取。",
  "- 依赖由应用管理。禁止自行安装或下载依赖。",
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
  "- 程序失败或超时会携带执行记录。",
  "- 程序失败、停止或超时后，已完成的文件写入仍然保留。",
  "- 继续前检查受影响的文件，复用完整内容，并修复未完成或损坏的部分。",
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
].join("\n");

/** 提交语义由 contract 提供。工具说明补充调用准备与回执后的恢复动作。 */
const WORKSPACE_APPLY_DESCRIPTION: string = [
  "将当前工作区的变更清单提交到工程。",
  "",
  "### 提交前",
  "",
  "- 清除旧批次遗留内容，使变更清单只包含本批次要提交的修改。",
  "- 工具按当前审批模式处理写入请求。需要用户授权时，工具会等待决定。",
  "",
  "### 提交与回执",
  "",
  `- ${AGENT_WORKSPACE_CONTRACT.apply.transaction}。`,
  `- ${AGENT_WORKSPACE_CONTRACT.apply.partial_success}。`,
  "- 根据回执确认哪些对象已提交、哪些被拒绝。",
  `- destroyed：${AGENT_WORKSPACE_CONTRACT.apply.result.destroyed}。`,
  "- 详细状态和拒绝原因见 `ws.contract.apply`。",
  "",
  "### 后续操作",
  "",
  "- `destroyed` 为 `true` 时，先调用 `workspace_run` 建立新快照。",
  "- 核实拒绝原因后，只重新准备尚未成功的修改。",
].join("\n");

/** apply 消费当前活动工作区中的一个提交批次，身份与对象 fp 由服务持有。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区由单一服务持有，模型接口由脚本与提交批次组成。 */
export function create_agent_workspace_tools(options: {
  workspace: Pick<AgentWorkspacePort, "run" | "apply_workspace">;
  todo: AgentTodoPort;
  approval: AgentWorkspaceApprovalPort;
}): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_run",
      label: "运行工作区程序",
      description: WORKSPACE_RUN_DESCRIPTION,
      executionMode: "sequential",
      parameters: WORKSPACE_RUN_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        const { execution, todos, images } = await options.workspace.run(
          params.script,
          options.todo.read(),
          effective_signal,
        );
        // run 的协作者可能在取消后才结算；Todo 只提交仍有效的工具调用结果。
        effective_signal.throwIfAborted();
        const result = agent_tool_result({
          ...execution,
          ...(images.length === 0
            ? {}
            : {
                images: images.map(({ path, image }) => ({
                  path,
                  mime_type: image.mimeType,
                  width: image.width,
                  height: image.height,
                  original_width: image.originalWidth,
                  original_height: image.originalHeight,
                })),
              }),
        });
        options.todo.write(todos);
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
    }),
    defineTool({
      name: "workspace_apply",
      label: "应用工作区",
      description: WORKSPACE_APPLY_DESCRIPTION,
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        // 批次成功后请求更新审批模式，用户后续选择由 AgentService 仲裁。
        let auto_revision: number | null = null;
        const result = await options.workspace.apply_workspace(
          options.approval.read_mode() === "auto"
            ? undefined
            : async (summary) => {
                const decision = await options.approval.wait_for_decision(
                  tool_call_id,
                  summary,
                  signal,
                );
                auto_revision = decision.auto_revision;
              },
        );
        if (auto_revision !== null) options.approval.activate_auto(auto_revision);
        return agent_tool_result(result);
      },
    }),
  ];
}
