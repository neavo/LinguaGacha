import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import {
  BatchRequestCompletionError,
  type BatchRequestSummary,
} from "../../batch-request/batch-request-service";
import { NATIVE_REQUEST_MAX_BYTES, RESPONSES_CONFIG_FIELDS } from "../../llm/native-responses";
import {
  define_agent_tool,
  agent_tool_result,
  AgentToolError,
  normalize_agent_tool_error,
} from "../tool-definition";

/** 顶层顺序工具等待请求和文件发布，正文只保存在工作区。 */
export function create_agent_batch_llm_request_tool(
  run: (
    model_config_id: string,
    request_file: string,
    signal: AbortSignal,
  ) => Promise<BatchRequestSummary>,
): ToolRegistration {
  return define_agent_tool({
    name: "batch_llm_request",
    executionMode: "sequential",
    description: [
      "批量执行独立 LLM 请求，结果保存到工作区供脚本读取。",
      "",
      "### 执行",
      "",
      "- 用 `workspace_run` 准备清单和输入文件。从 `model_configs.json` 选择 `model_config_id`，模型、生成参数与限流采用本次启动时的设置。",
      '- 清单格式：`{"format":"messages","requests":[{"id":"001","input_file":"inputs/001.json"}]}`。`requests` 非空，`id` 为唯一非空字符串。',
      `- \`request_file\` 相对工作区，\`input_file\` 相对清单目录，均支持绝对路径。每个 JSON 文件不超过 ${NATIVE_REQUEST_MAX_BYTES / 1_000_000} MB，运行期间不要改写。`,
      '- `messages` 支持文本协议及 OAuth。输入示例：`{"messages":[{"role":"user","content":"归纳这段材料。"}]}`。消息数组非空，角色仅限 `system`、`user`，正文为字符串。',
      "- `responses` 仅支持 API Key 的 `OpenAIResponses` 配置。输入为含 `input`（字符串或数组）的原生载荷，不支持流式或后台执行。",
      `- \`responses\` 以下字段只放在模型设置中：${RESPONSES_CONFIG_FIELDS.map((field) => `\`${field}\``).join("、")}。`,
      "- 工具等待整批收尾，不受脚本时限限制。网络恢复可能持续到成功或停止。用户停止后，本轮不要重启批量工具。",
      "",
      "### 结果",
      "",
      "|返回字段|含义|",
      "|---|---|",
      "|`run_id`|批次标识|",
      "|`status`|`done` 为已结算，不代表全部成功。`stopped` 为已停止|",
      "|`stop_source`|`user` 用户停止、`parent` 上层取消、`shutdown` 环境关闭|",
      "|`total`、`succeeded`、`failed`、`unfinished`|总数、成功数、失败数、未完成数|",
      "|`usage`|本次进度、耗时与已知 token 用量，`usage_complete` 标记完整性|",
      "|`result_file`|结果索引的绝对路径，按 `id` 关联各项，未完成项无结果文件|",
      "",
      "- 逐项路径相对索引目录。文本读取 `response.text`、`response.thinking`，原生响应读取脱敏的 `response.raw`，失败原因读取 `error`。",
      "- 出错仍保留已发布成果。续跑只处理失败或未完成项，无回执的请求再次发送可能重复计费。",
    ].join("\n"),
    parameters: Type.Object(
      {
        model_config_id: Type.String({
          minLength: 1,
          description: "从 `model_configs.json` 选择的已保存模型配置 ID",
        }),
        request_file: Type.String({
          minLength: 1,
          description: "请求清单 JSON 文件的工作区相对路径或本机绝对路径",
        }),
      },
      { additionalProperties: false },
    ),
    execute: async (input, _api, context) => {
      try {
        return agent_tool_result(
          await run(
            input.model_config_id,
            input.request_file,
            context.abortSignal ?? new AbortController().signal,
          ),
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
