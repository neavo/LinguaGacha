import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  AgentBatchTranslationRequest,
  BatchTranslationResult,
} from "../../../domain/batch-translation";
import { agent_tool_result } from "./definition";

const PARAMETERS = Type.Object(
  {
    scope: Type.Union([
      Type.Object(
        { kind: Type.Literal("all") },
        {
          additionalProperties: false,
          description: "当前工程中全部符合条件的 `items`。",
        },
      ),
      Type.Object(
        {
          kind: Type.Literal("items"),
          item_ids: Type.Array(Type.Integer({ minimum: 1 }), {
            minItems: 1,
            description: "从当前工程 `items` 快照取得的目标 `item_id` 集合。",
          }),
        },
        { additionalProperties: false },
      ),
    ]),
    include_errors: Type.Boolean({
      description: "是否包含范围内失败的 `items`，按用户已确认的决定填写。",
    }),
  },
  { additionalProperties: false },
);

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_item_translation_tool(
  run: (
    request: AgentBatchTranslationRequest,
    signal: AbortSignal,
  ) => Promise<BatchTranslationResult>,
): ToolDefinition {
  return defineTool({
    name: "run_batch_item_translation",
    label: "批量翻译条目",
    description: [
      "批量翻译当前工程的待译 `items` 及参数纳入的失败条目，由引擎直接提交译文。不支持 `pages`，页面译稿由 Agent 形成并通过工作区提交。",
      "",
      "### 执行与写入",
      "",
      "- 使用已保存的批量翻译模型偏好。",
      "- 工具等待提交和资源收尾完成。",
      "- 后续工作区判断应读取最新快照。",
      "",
      "### 结果处理",
      "",
      "|返回字段|含义与动作|",
      "|---|---|",
      "|run_progress|本轮目标 `items`、成功与最终失败数量，以及用量|",
      "|progress|工程 `items` 累计翻译进度|",
      "|status|done 表示本轮运行结束。仍需核对失败和剩余目标|",
      "|stop_source|user 表示用户停止。汇报当前结果，等待用户明确要求继续|",
    ].join("\n"),
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, params, signal) =>
      agent_tool_result(await run(params, signal ?? new AbortController().signal)),
  });
}
