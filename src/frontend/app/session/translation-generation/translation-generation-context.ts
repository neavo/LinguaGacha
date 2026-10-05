import { createContext, useContext } from "react";
import type { TranslationGenerationFlow } from "@frontend/features/translation-generation/use-translation-generation-flow";

export const TranslationGenerationContext = createContext<TranslationGenerationFlow | null>(null);

/** 页面与任务完成通知取得同一工程译文生成入口。 */
export function useTranslationGeneration(): TranslationGenerationFlow {
  const flow = useContext(TranslationGenerationContext);
  if (flow === null) {
    throw new Error("useTranslationGeneration must be used inside TranslationGenerationProvider");
  }
  return flow;
}
