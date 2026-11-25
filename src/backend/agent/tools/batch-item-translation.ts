import { ITEM_STATUSES } from "../../../domain/item";
import { Type } from "typebox";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { AgentBatchTranslationRequest } from "../../../domain/batch-translation";
import type { BatchTaskResult, BatchTaskStopSource } from "../../../domain/batch-task";
import { BatchTaskCompletionError } from "../../batch-task/batch-task-runtime";
import {
  define_agent_tool,
  agent_tool_result,
  AgentToolError,
  normalize_agent_tool_error,
} from "../tool-definition";

/** 模型可见的单次调用回执，字段名使用模型易读的业务词。 */
type AgentBatchTranslationResult = Readonly<{
  status: BatchTaskResult["status"];
  stop_source?: BatchTaskStopSource;
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
function format_batch_translation_result(result: BatchTaskResult): AgentBatchTranslationResult {
  const { status, stop_source, progress } = result;
  const outcome = { status, ...(stop_source === undefined ? {} : { stop_source }) };
  if (progress === null) return { ...outcome, items: null, usage: null };
  const { total, succeeded, failed, time, input_tokens, reasoning_tokens, output_tokens } =
    progress;
  return {
    ...outcome,
    items: { total, succeeded, failed, unfinished: total - succeeded - failed },
    usage: {
      elapsed_seconds: time,
      input_tokens,
      reasoning_tokens,
      output_tokens,
      total_tokens: input_tokens + reasoning_tokens + output_tokens,
    },
  };
}

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_item_translation_tool(
  run: (
    request: AgentBatchTranslationRequest,
    thinking_downgrade: boolean,
    signal: AbortSignal,
  ) => Promise<BatchTaskResult>,
): ToolRegistration {
  return define_agent_tool({
    name: "batch_item_translation",
    description: [
      "批量翻译当前工程的 `items`，成功译文直接提交到工程。",
      "",
      "### 执行",
      "",
      "- 一次传入全部目标，至少提供 `item_ids` 或 `item_statuses`。数组内取并集，两个条件取交集。",
      "- 省略 `item_statuses` 会翻译指定 ID 的所有状态，包括已译、排除、跳过和重复条目。",
      "- 工具逐批提交成功译文，失败条目保持原状。后续读取译文时刷新工作区快照。",
      "- 批量翻译与同工程的翻译和写入互斥。遇到 `runtime.busy` 时等工程空闲后再发起，或告知用户。",
      "- 用户停止任一批量工具后，本轮不要重启批量工具。",
      "",
      "### 结果",
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`status`|`done` 本轮结束、`stopped` 已停止、`error` 出错|",
      "|`stop_source`|`user` 为用户停止，`parent` 为上层任务取消，`shutdown` 为运行环境关闭|",
      "|`items`|本轮条目数，按 `failed` 和 `unfinished` 判断是否全部成功|",
      "|`usage`|本轮耗时与 Token 用量|",
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
          Type.Boolean({
            description: "默认 `true`，降低思考等级。供应商明确拒绝降低时，设为 `false` 重试。",
          }),
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
        if (error instanceof BatchTaskCompletionError) {
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
