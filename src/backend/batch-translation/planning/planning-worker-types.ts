import type { LogError } from "../../../shared/error";

/** 批次身份只用于线程通信；缓存键和条目身份留在父线程。 */
export type PlanningWorkerIncomingMessage =
  | { readonly id: number; readonly type: "count_tokens"; readonly texts: readonly string[] }
  | { readonly id: number; readonly type: "cancel" };

/** 成功计数与请求文本同序；取消是正常终态，不伪装成执行异常。 */
export type PlanningWorkerOutgoingMessage =
  | { readonly id: number; readonly status: "done"; readonly counts: readonly number[] }
  | { readonly id: number; readonly status: "cancelled" }
  | { readonly id: number; readonly status: "error"; readonly error: LogError };
