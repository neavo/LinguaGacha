import { ITEM_STATUSES } from "../../../domain/item";
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type {
  AgentBatchTranslationRequest,
  BatchTranslationResult,
  BatchTranslationStopSource,
} from "../../../domain/batch-translation";
import { BatchTranslationCompletionError } from "../../batch-translation/batch-translation-runtime";
import {
  define_agent_tool,
  agent_tool_result,
  AgentToolError,
  normalize_agent_tool_error,
} from "../tool-definition";

/** 模型可见的单次调用回执，字段名使用模型易读的业务词。 */
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

/** 模型回执只表达本次调用，正常与失败回执共用统计口径。 */
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
    thinking_downgrade: boolean,
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
      "- 省略状态条件会纳入指定 ID 的已译、排除、跳过和重复条目",
      "- 目标的已有译文会被覆盖，工具完成后刷新工作区，需要时读取最新快照",
      "- 工具在内部分批翻译并逐批提交。当前上下文首次调用前，先用一条目标 `item` 测试，通过后用一次调用处理其余全部目标",
      "- 调用失败时结合错误判断原因，由思考等级导致时传入 `thinking_downgrade: false`，当前上下文的后续调用沿用",
      "",
      "### 结果",
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|items|条目统计|",
      "|usage|用量统计|",
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
        thinking_downgrade: Type.Optional(
          Type.Boolean({ description: "降低本次翻译的思考等级，默认开启" }),
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async ({ thinking_downgrade = true, ...request }, _api, context) => {
      try {
        return agent_tool_result(
          format_batch_translation_result(
            await run(
              request,
              thinking_downgrade,
              context.abortSignal ?? new AbortController().signal, // 宿主未提供取消信号时使用不会触发的信号
            ),
          ),
        );
      } catch (error) {
        if (error instanceof BatchTranslationCompletionError) {
          const failure = normalize_agent_tool_error(error.cause);
          // 错误回执本身表达失败，`status` 留给原因的公开详情，例如供应商 HTTP 状态。
          const { status: _status, ...summary } = format_batch_translation_result(error.result);
          throw new AgentToolError({ ...failure.details, ...summary }, error, failure.severity);
        }
        throw error;
      }
    },
  });
}
