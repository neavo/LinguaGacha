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
      Type.Object({ kind: Type.Literal("all") }, { additionalProperties: false }),
      Type.Object(
        {
          kind: Type.Literal("items"),
          item_ids: Type.Array(Type.Integer({ minimum: 1 }), {
            minItems: 1,
            description: "从当前工程事实取得的目标 item 标识。",
          }),
        },
        { additionalProperties: false },
      ),
    ]),
    include_errors: Type.Boolean({
      description: "是否包含范围内失败条目，按用户已确认的决定填写。",
    }),
  },
  { additionalProperties: false },
);

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_translation_tool(
  run: (
    request: AgentBatchTranslationRequest,
    signal: AbortSignal,
  ) => Promise<BatchTranslationResult>,
): ToolDefinition {
  return defineTool({
    name: "run_batch_translation",
    label: "批量翻译",
    description: [
      "翻译当前工程中符合资格的待译条目。已有成功译文保持其事实。输入参数决定目标范围和失败条目的处理。",
      "",
      "### 执行与写入",
      "",
      "- 使用已保存的批量翻译模型偏好。",
      "- 引擎直接提交译文。工具等待提交和资源收尾完成。",
      "- 后续工作区判断应读取最新快照。",
      "",
      "### 结果处理",
      "",
      "|返回字段|含义与动作|",
      "|---|---|",
      "|run_progress|本轮目标、成功与最终失败数量，以及用量|",
      "|progress|工程累计进度|",
      "|status|done 表示本轮运行结束。仍需核对失败和剩余目标|",
      "|stop_source|user 表示用户停止。汇报当前结果，等待用户明确要求继续|",
    ].join("\n"),
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, params, signal) =>
      agent_tool_result(await run(params, signal ?? new AbortController().signal)),
  });
}
