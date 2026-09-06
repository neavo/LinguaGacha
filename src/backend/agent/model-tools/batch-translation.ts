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
      "翻译当前工程全量或指定 item 范围内的待译条目，按 include_errors 纳入失败条目。指定范围只翻译符合资格的目标，已有成功译文保持其事实。",
      "宿主按用户保存的批量翻译模型偏好执行；引擎自行提交译文，工具等待提交与收尾完成。后续工作区判断加载最新快照。",
      "返回 run_progress（本轮目标、成功与最终失败数量及用量）和 progress（工程累计进度）。status 为 done 表示本轮运行结束，仍需核对失败与剩余目标。",
      "stop_source 为 user 时汇报当前结果并结束翻译工作，等待用户明确要求继续。",
    ].join("\n\n"),
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, params, signal) =>
      agent_tool_result(await run(params, signal ?? new AbortController().signal)),
  });
}
