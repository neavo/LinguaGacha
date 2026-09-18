import { createContext, useContext } from "react";
import type { TranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";

export const TranslationExportContext = createContext<TranslationExportFlow | null>(null);

/** 页面与任务完成通知取得同一工程导出入口。 */
export function useTranslationExport(): TranslationExportFlow {
  const flow = useContext(TranslationExportContext);
  if (flow === null) {
    throw new Error("useTranslationExport must be used inside TranslationExportProvider");
  }
  return flow;
}
