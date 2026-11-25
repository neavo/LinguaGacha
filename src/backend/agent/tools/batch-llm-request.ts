import type { AgentModelUsage } from "../../../domain/model";
import { Type, type Static } from "typebox";
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
    model_usage: Type.Enum(BATCH_LLM_REQUEST_MODEL_USAGES, {
      description: "模型用途：`agent` 当前主控模型、`media` 音视频子模型",
    }),
    thinking_downgrade: Type.Optional(
      Type.Boolean({
        description:
          "默认设为 `false`，即保持思考等级，任务简单时设为 `true` 以降费提速",
      }),
    ),
    request_file: Type.String({
      minLength: 1,
      pattern: "\\S",
      description: "请求清单 JSON 路径，支持工作区相对路径或绝对路径",
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
      "批量执行独立 LLM 请求，将索引与逐项结果写入当前对话工作区，不修改工程数据。",
      "",
      "### 使用前提",
      "",
      "- 仅在适用技能或用户明确要求时调用，其余任务通过 `workspace_run` 配合当前对话完成。",
      "- 每条请求独立运行，不含当前对话历史、已加载技能、工程知识与工具，全部上下文由输入文件提供。",
      "",
      "### 清单与输入",
      "",
      `- 用 \`workspace_run\` 生成清单与输入文件，单个 JSON 文件不超过 ${LLM_REQUEST_MAX_BYTES / 1_000_000} MB。`,
      '- 清单格式：`{"format":"messages","requests":[{"id":"001","input_file":"inputs/001.json"}]}`，`requests` 非空，每项 `id` 为唯一非空字符串。',
      "- 路径基准：`request_file` 相对当前工作区，`input_file` 相对清单目录，两者均支持绝对路径。",
      '- 输入文件格式：`{"messages":[{"role":"user","content":"..."}]}`，`messages` 非空，角色仅限 `system`、`user`。',
      "- `system.content` 仅支持字符串，`user.content` 支持字符串或非空内容块数组：",
      '  - 文本块：`{"type":"text","text":"提示词"}`',
      '  - 媒体块：`{"type":"image|audio|video","mime_type":"<type>/<subtype>","data":"原始字节的 Base64"}`',
      "",
      "### 返回与结果定位",
      "",
      "工具等待整批收尾后返回摘要：",
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`run_id`|批次标识|",
      "|`status`|`done` 本批已结算（不代表全部成功）、`stopped` 已停止|",
      "|`stop_source`|`user` 用户停止、`parent` 上层取消、`shutdown` 环境关闭|",
      "|`total`、`succeeded`、`failed`、`unfinished`|总数、成功数、失败数、未完成数|",
      "|`usage`|进度、耗时与已知 token 用量，`usage_complete` 标记完整性|",
      "|`result_file`|结果索引相对当前对话工作区的 POSIX 路径，如 `work/batch-requests/<run_id>/result.json`|",
      "",
      "- 结果索引按 `id` 关联请求，逐项结果路径相对索引目录，未完成项无结果文件。",
      "- 逐项结果正文位于 `response.text`、`response.thinking`，失败原因位于 `error`。",
      "- 工程副本续聊时，早期历史回执中的 `result_file` 可能仍指向源工程绝对路径，读取历史结果应按回执 `run_id` 定位当前工作区的 `work/batch-requests/<run_id>/result.json`，文件不存在时如实提示材料缺失。",
      "",
      "### 停止与续跑",
      "",
      "- 用户停止任一批量工具后，本轮不要重启批量工具。",
      "- 批次出错仍保留已发布的逐项结果。",
      "- 续跑只重发失败或未完成项，缺少本地回执不代表远端未执行，重发可能重复计费。",
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
