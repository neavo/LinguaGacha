import { createContext, useContext } from "react";
import type { BatchTask } from "@frontend/app/session/batch-task/use-batch-task";

export type BatchTaskSessionContextValue = {
  batch_task: BatchTask; // 常驻监听翻译任务完成意图
};

// 当前项目的任务交互随应用 session 常驻。
export const BatchTaskSessionContext = createContext<BatchTaskSessionContextValue | null>(null);

// 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
export function useBatchTaskSession(): BatchTaskSessionContextValue {
  const context_value = useContext(BatchTaskSessionContext);
  if (context_value === null) {
    throw new Error("useBatchTaskSession must be used inside BatchTaskSessionProvider.");
  }

  return context_value;
}
