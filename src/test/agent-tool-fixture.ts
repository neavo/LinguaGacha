import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";

/** 独立业务工具只读取调用身份与取消信号；SDK 操作由真实 Harness 的集成测试提供。 */
export function agent_tool_call(id: string, signal?: AbortSignal): [ToolExecutionApi, Context] {
  return [
    { callId: id } as ToolExecutionApi,
    signal === undefined ? BACKGROUND_CONTEXT : withAbortSignal(signal, BACKGROUND_CONTEXT),
  ];
}
