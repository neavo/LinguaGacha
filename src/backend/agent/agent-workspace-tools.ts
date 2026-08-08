import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** export 只选择唯一 target，其余上下文由 Backend 固定生成。 */
const WORKSPACE_EXPORT_PARAMETERS = Type.Object(
  {
    target: Type.Union([Type.Literal("items"), Type.Literal("glossary")], {
      description: "本次唯一可导回工程的数据类型。",
    }),
  },
  { additionalProperties: false },
);

/** 模型只提交函数体，不接触工作区绝对路径。 */
const WORKSPACE_RUN_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description:
        "在一次性 Chromium 沙箱中执行的异步 JavaScript 函数体；通过参数 workspace 使用流式文件 API，return 值必须是小型 JSON 摘要。",
    }),
  },
  { additionalProperties: false },
);

/** import 始终消费当前活动工作区，不接受模型重传身份或 revision。 */
const WORKSPACE_IMPORT_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区始终保持单一状态拥有者，三个工具只做参数适配。 */
export function create_agent_workspace_tools(workspace: AgentWorkspacePort): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_export",
      label: "导出工作区",
      description:
        "将当前工程的完整相关事实导出到一次性磁盘工作区。target 决定唯一可导入数据；items、警告、全部质量规则、提示词、工程设置和相关分析上下文会自动按固定布局导出。返回 manifest 摘要而不是大数据。新导出会替换旧工作区。",
      executionMode: "sequential",
      parameters: WORKSPACE_EXPORT_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.export_workspace(params.target);
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
    defineTool({
      name: "workspace_run",
      label: "运行工作区脚本",
      description:
        "在无 Node、无 Shell、无外网的一次性 Chromium 沙箱中执行 JavaScript。脚本可使用 workspace.readJson/readJsonl/readLines/readText、writeJson/writeJsonl/writeText、list、remove；大文件必须优先使用 JSONL 流。只有 target/ 与 scratch/ 可写，context/ 和 manifest.json 只读。脚本失败或停止会废弃整个工作区，成功时可继续运行其它脚本。",
      executionMode: "sequential",
      parameters: WORKSPACE_RUN_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        return agent_tool_result({
          result: await workspace.run_script(params.script, effective_signal),
        });
      },
    }),
    defineTool({
      name: "workspace_import",
      label: "导入工作区",
      description:
        "校验并原子导入当前工作区唯一 target。只比较允许修改的字段，context 和 scratch 永不导入；工程身份、设置或任一依赖 revision 变化时整批拒绝并要求重新导出。成功或无变化后销毁工作区。该工具会修改工程，必须在用户明确批准当前工作区方案后调用。",
      executionMode: "sequential",
      parameters: WORKSPACE_IMPORT_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.import_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
  ];
}
