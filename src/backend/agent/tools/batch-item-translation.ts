import { ITEM_STATUSES } from "../../../domain/item";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type {
  AgentBatchTranslationRequest,
  BatchTranslationResult,
  BatchTranslationStopSource,
} from "../../../domain/batch-translation";
import { BatchTranslationCompletionError } from "../../batch-translation/batch-translation-runtime";
import { define_agent_tool, agent_tool_result, AgentToolError } from "../tool-definition";

type AgentBatchTranslationResult = Readonly<{
  status: BatchTranslationResult["status"];
  stop_source?: BatchTranslationStopSource;
  items: Readonly<{ total: number; succeeded: number; failed: number; unfinished: number }> | null;
  usage: Readonly<{
    elapsed_seconds: number;
    input_tokens: number;
    reasoning_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }> | null;
}>;

/** 模型回执只表达本次调用，正常与收尾异常共用统计口径。 */
function format_batch_translation_result(
  result: BatchTranslationResult,
): AgentBatchTranslationResult {
  const progress = result.run_progress;
  return {
    status: result.status,
    ...(result.stop_source === undefined ? {} : { stop_source: result.stop_source }),
    items:
      progress === undefined
        ? null
        : {
            total: progress.total_line,
            succeeded: progress.processed_line,
            failed: progress.error_line,
            unfinished: progress.total_line - progress.processed_line - progress.error_line,
          },
    usage:
      progress === undefined
        ? null
        : {
            elapsed_seconds: progress.time,
            input_tokens: progress.total_input_tokens,
            reasoning_tokens: progress.total_reasoning_tokens,
            output_tokens: progress.total_output_tokens,
            total_tokens: progress.total_tokens,
          },
  };
}

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_item_translation_tool(
  run: (
    request: AgentBatchTranslationRequest,
    signal: AbortSignal,
  ) => Promise<BatchTranslationResult>,
): ToolRegistration {
  return define_agent_tool({
    name: "batch_item_translation",
    description: [
      "按 ID 和状态条件的交集批量翻译当前工程的 `items`，翻译结果由工具直接提交，无需经过工作区",
      "",
      "### 执行",
      "",
      "- 至少提供一个筛选条件，筛选条件不能是空数组，省略的某条件表示不限制该条件",
      "- 同一筛选条件内部取并集，多个筛选条件之间取交集",
      "- 省略状态条件会纳入指定 ID 的已译、排除、跳过和重复条目，已有译文可能被覆盖。",
      "- 已有的译文会被覆盖，工具完成刷新工作区读取最新快照",
      "",
      "### 结果",
      "",
      "|返回字段|含义与动作|",
      "|---|---|",
      "|items|本次调用的条目统计|",
      "|usage|本次调用已统计的用量|",
      "|status|结果状态|",
      "|stop_source|`user` 为用户停止，`parent` 为上层任务取消，`shutdown` 为运行环境关闭|",
    ].join("\n"),
    parameters: Type.Object(
      {
        // `Number` 与 `multipleOf` 避免 SDK 的 `Integer` 转换把小数截断为另一个条目 ID。
        item_ids: Type.Optional(
          Type.Array(Type.Number({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, multipleOf: 1 }), {
            minItems: 1,
            description: "目标对象的 `item_id`",
          }),
        ),
        item_statuses: Type.Optional(
          Type.Array(Type.Union(ITEM_STATUSES.map((status) => Type.Literal(status))), {
            minItems: 1,
            description: "目标对象的翻译状态 `status`",
          }),
        ),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
    executionMode: "sequential",
    execute: async (params, _api, context) => {
      try {
        return agent_tool_result(
          format_batch_translation_result(
            await run(params, context.abortSignal ?? new AbortController().signal),
          ),
        );
      } catch (error) {
        if (error instanceof BatchTranslationCompletionError)
          throw new AgentToolError(
            { code: "tool_failed", ...format_batch_translation_result(error.result) },
            error,
            "fault",
          );
        throw error;
      }
    },
  });
}
