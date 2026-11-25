import { createContext, useContext } from "react";
import type { BatchTask } from "@frontend/app/session/batch-task/use-batch-task";

/** 工程工作区内的入口和侧栏共用一个批量任务会话。 */
export const BatchTaskSessionContext = createContext<BatchTask | null>(null);

/** 批量任务入口须挂载在工程会话内。 */
export function useBatchTaskSession(): BatchTask {
  const context_value = useContext(BatchTaskSessionContext);
  if (context_value === null) {
    throw new Error("useBatchTaskSession must be used inside ProjectSessionProvider.");
  }

  return context_value;
}
