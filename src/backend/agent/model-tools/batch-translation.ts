import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { BatchTranslationResult } from "../../../domain/batch-translation";
import { agent_tool_result } from "./definition";

const PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 用户结束启动请求时，本轮后续调用复用同一未启动结果。 */
export type AgentBatchTranslationResult =
  | BatchTranslationResult
  | Readonly<{ status: "not_started"; reason: "cancelled" | "expired" }>;

/** 顺序工具等待批量翻译的提交和资源收尾，摘要留在当前 Agent round。 */
export function create_agent_batch_translation_tool(
  run: (signal: AbortSignal, tool_call_id: string) => Promise<AgentBatchTranslationResult>,
): ToolDefinition {
  return defineTool({
    name: "run_batch_translation",
    label: "批量翻译",
    description:
      "开始或继续当前工程的全量翻译。宿主先让用户选择使用当前 Agent 接入点或其他接入点，保存翻译接入点选择后执行并等待本轮运行结束。当前接入点继承本轮 Agent 配置，其他接入点采用自身保存的配置。status 为 not_started 表示用户取消或确认超时；stop_source 为 user 表示用户主动停止。遇到这些结果时汇报当前状态并结束翻译工作，等待用户明确要求继续。",
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (id, _params, signal) =>
      agent_tool_result(await run(signal ?? new AbortController().signal, id)),
  });
}
