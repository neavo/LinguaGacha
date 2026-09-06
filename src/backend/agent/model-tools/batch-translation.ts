import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BatchTranslationResult } from "../../../domain/batch-translation";
import { agent_tool_result } from "./definition";

const PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_translation_tool(
  run: (signal: AbortSignal) => Promise<BatchTranslationResult>,
): ToolDefinition {
  return defineTool({
    name: "run_batch_translation",
    label: "批量翻译",
    description:
      "开始或继续当前工程的全量翻译。宿主按用户保存的批量翻译模型偏好直接执行；批量引擎在运行中自行提交译文，工具等待本轮提交和收尾完成后返回。保持一致时继承本轮 Agent 生效配置，指定模型时采用该模型保存的配置。status 为 done 表示本轮运行结束；progress.processed_line 为成功提交数，progress.error_line 为最终失败数，progress.line 为两者之和。进度计数包含既有工程进度，继续翻译时按累计统计解读。stop_source 为 user 表示用户主动停止。遇到该结果时汇报当前状态并结束翻译工作，等待用户明确要求继续。",
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, _params, signal) =>
      agent_tool_result(await run(signal ?? new AbortController().signal)),
  });
}
