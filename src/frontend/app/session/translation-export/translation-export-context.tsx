import { createContext, useContext, type ReactNode } from "react";

import { TranslationExportDialog } from "@frontend/features/translation-export/translation-export-dialog";
import {
  useTranslationExportFlow,
  type TranslationExportFlow,
} from "@frontend/features/translation-export/use-translation-export-flow";

const TranslationExportContext = createContext<TranslationExportFlow | null>(null);

/** 工程级导出随应用常驻，各页面与任务完成通知共享一次预检和确认。 */
export function TranslationExportProvider(props: { children: ReactNode }): JSX.Element {
  const flow = useTranslationExportFlow();
  return (
    <TranslationExportContext.Provider value={flow}>
      {props.children}
      <TranslationExportDialog {...flow} />
    </TranslationExportContext.Provider>
  );
}

/** 页面与任务完成通知取得同一工程导出入口。 */
export function useTranslationExport(): TranslationExportFlow {
  const flow = useContext(TranslationExportContext);
  if (flow === null) {
    throw new Error("useTranslationExport must be used inside TranslationExportProvider");
  }
  return flow;
}
