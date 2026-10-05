import type { JSX, ReactNode } from "react";
import { TranslationGenerationDialog } from "@frontend/features/translation-generation/translation-generation-dialog";
import { useTranslationGenerationFlow } from "@frontend/features/translation-generation/use-translation-generation-flow";
import { TranslationGenerationContext } from "./translation-generation-context";

/** 工程级译文生成随应用常驻，各页面与任务完成通知共享一次预检和确认。 */
export function TranslationGenerationProvider(props: { children: ReactNode }): JSX.Element {
  const flow = useTranslationGenerationFlow();
  return (
    <TranslationGenerationContext.Provider value={flow}>
      {props.children}
      <TranslationGenerationDialog {...flow} />
    </TranslationGenerationContext.Provider>
  );
}
