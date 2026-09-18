import type { ReactNode } from "react";
import { TranslationExportDialog } from "@frontend/features/translation-export/translation-export-dialog";
import { useTranslationExportFlow } from "@frontend/features/translation-export/use-translation-export-flow";
import { TranslationExportContext } from "./translation-export-context";

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
