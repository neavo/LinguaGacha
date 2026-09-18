import { createContext, useContext } from "react";
import type { BatchTranslationTask } from "@frontend/app/session/batch-translation/use-batch-translation-task";

export type BatchTranslationSessionContextValue = {
  batch_translation_task: BatchTranslationTask; // 常驻监听翻译任务完成意图
};

// 当前项目的任务交互随应用 session 常驻。
export const BatchTranslationSessionContext =
  createContext<BatchTranslationSessionContextValue | null>(null);

// 统一抛出 Provider 缺失错误，调用方不用重复空值分支。
export function useBatchTranslationSession(): BatchTranslationSessionContextValue {
  const context_value = useContext(BatchTranslationSessionContext);
  if (context_value === null) {
    throw new Error(
      "useBatchTranslationSession must be used inside BatchTranslationSessionProvider.",
    );
  }

  return context_value;
}
