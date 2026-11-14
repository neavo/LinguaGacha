import type { AgentModelUsage } from "../../../domain/model";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import {
  BatchRequestCompletionError,
  type BatchRequestSummary,
} from "../../batch-request/batch-request-service";
import { LLM_REQUEST_MAX_BYTES } from "../../llm/llm-request";
import {
  define_agent_tool,
  agent_tool_result,
  AgentToolError,
  normalize_agent_tool_error,
} from "../tool-definition";

// 翻译子模型只属于批量翻译工具，通用请求不能借用该用途。
const BATCH_LLM_REQUEST_MODEL_USAGES = [
  "agent",
  "media",
] as const satisfies readonly AgentModelUsage[];
const BATCH_LLM_REQUEST_SCHEMA = Type.Object(
  {
    model_usage: Type.Union(
      BATCH_LLM_REQUEST_MODEL_USAGES.map((usage) => Type.Literal(usage)),
      { description: "模型用途：`agent` 当前主控模型、`media` 音视频子模型" },
    ),
    thinking_downgrade: Type.Optional(
      Type.Boolean({
        description: "默认 `false`，设为 `true` 时降低模型思考等级",
      }),
    ),
    request_file: Type.String({
      minLength: 1,
      pattern: "\\S",
      description: "请求清单 JSON 文件的工作区相对路径或本机绝对路径",
    }),
  },
  { additionalProperties: false },
);
export type BatchLlmRequestInput = Static<typeof BATCH_LLM_REQUEST_SCHEMA>;

/** 顶层顺序工具等待请求和文件发布，正文只保存在工作区。 */
export function create_agent_batch_llm_request_tool(
  run: (input: BatchLlmRequestInput, signal: AbortSignal) => Promise<BatchRequestSummary>,
): ToolRegistration {
  return define_agent_tool({
    name: "batch_llm_request",
    executionMode: "sequential",
    description: [
      "批量执行独立 LLM 请求，结果保存到工作区供脚本读取。",
      "",
      "### 何时使用",
      "",
      "- 只在适用技能或用户明确要求使用 `batch_llm_request` 时调用。",
      "- 其余工作按 `CodeAct 范式` 和适用技能，通过 `workspace_run` 脚本配合当前对话完成。",
      "- 独立请求不含当前对话历史、已加载技能、工程知识与工作区工具，全部上下文来自输入文件中的 `messages`。",
      "",
      "### 执行",
      "",
      "- 用 `workspace_run` 准备清单和输入文件。",
      '- 清单格式：`{"format":"messages","requests":[{"id":"001","input_file":"inputs/001.json"}]}`。',
      "- `requests` 必须非空。每项 `id` 必须是唯一非空字符串。",
      "- 相对路径基准：`request_file` 使用工作区，`input_file` 使用清单目录。两者也支持绝对路径。",
      `- 每个 JSON 文件不超过 ${LLM_REQUEST_MAX_BYTES / 1_000_000} MB。`,
      "",
      "### 输入文件",
      "",
      '- 示例：`{"messages":[{"role":"user","content":"<任务、背景、材料与输出要求>"}]}`。',
      "- 将必要背景、约束和输出协议写入消息。",
      "- `messages` 必须非空。消息角色仅限 `system`、`user`。",
      "- `system` 正文必须是字符串。",
      "- `user` 正文可以是字符串或非空内容块数组。",
      '- 文本块：`{"type":"text","text":"提示词"}`。',
      '- 媒体块：`{"type":"video","mime_type":"video/mp4","data":"原始字节的 Base64"}`。',
      "- 媒体 `type` 可为 `image`、`audio`、`video`。`mime_type` 必须与媒体类型一致。",
      "",
      "### 结果",
      "",
      "工具等待整批收尾后返回。",
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`run_id`|批次标识|",
      "|`status`|`done` 为已结算，不代表全部成功。`stopped` 为已停止|",
      "|`stop_source`|`user` 用户停止、`parent` 上层取消、`shutdown` 环境关闭|",
      "|`total`、`succeeded`、`failed`、`unfinished`|总数、成功数、失败数、未完成数|",
      "|`usage`|本次进度、耗时与已知 token 用量，`usage_complete` 标记完整性|",
      "|`result_file`|结果索引的绝对路径|",
      "",
      "- 索引按 `id` 关联请求。逐项路径相对索引目录。",
      "- 未完成项没有结果文件。",
      "- 正文位于 `response.text`、`response.thinking`。失败原因位于 `error`。",
      "",
      "### 停止与续跑",
      "",
      "- 用户停止任一批量工具后，本轮不要重启批量工具。",
      "- 出错仍保留已发布成果。",
      "- 续跑只处理失败或未完成项。",
      "- 无回执的请求再次发送可能重复计费。",
    ].join("\n"),
    parameters: BATCH_LLM_REQUEST_SCHEMA,
    execute: async (input, _api, context) => {
      try {
        return agent_tool_result(
          await run(input, context.abortSignal ?? new AbortController().signal),
        );
      } catch (error) {
        if (error instanceof BatchRequestCompletionError) {
          const failure = normalize_agent_tool_error(error.cause);
          const { status: _status, ...summary } = error.summary;
          throw new AgentToolError({ ...failure.details, ...summary }, error, failure.severity);
        }
        throw error;
      }
    },
  });
}
