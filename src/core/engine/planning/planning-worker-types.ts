import type { TaskTokenCountInput, TaskTokenCountResult } from "./token-metric-cache";

/**
 * planning worker 的 token 计算请求；id 只服务线程消息匹配，不进入任务事实。
 */
export interface PlanningCountTokensMessage {
  id: string;
  type: "count_tokens";
  items: TaskTokenCountInput[];
}

/**
 * planning worker 的取消请求；取消只影响对应消息，不关闭整个 worker。
 */
export interface PlanningCancelMessage {
  id: string;
  type: "cancel";
}

/**
 * 主线程发给 planning worker 的全部消息形状。
 */
export type PlanningWorkerIncomingMessage = PlanningCountTokensMessage | PlanningCancelMessage;

/**
 * planning worker 返回的成功或失败结果，错误文本只作为 transport 诊断。
 */
export interface PlanningWorkerOutgoingMessage {
  id: string;
  ok: boolean;
  data?: TaskTokenCountResult[];
  error?: string;
}
