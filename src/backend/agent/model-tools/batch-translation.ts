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
    description: "开始或继续当前工程的全量翻译，等待本轮运行结束后返回状态与累计进度摘要。",
    parameters: PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, _params, signal) =>
      agent_tool_result(await run(signal ?? new AbortController().signal)),
  });
}
