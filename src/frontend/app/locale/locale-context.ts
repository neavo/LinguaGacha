import { createContext, useContext } from "react";
import type { Locale, LocaleKey } from "@shared/i18n";

export type LocaleContextValue = {
  locale: Locale;
  t: (key: LocaleKey, params?: Record<string, string>) => string;
};

export const LocaleContext = createContext<LocaleContextValue | null>(null);

/** 词典变化由 Provider 发布，消费者始终读取同一 Context。 */
export function useI18n(): LocaleContextValue {
  const locale_context = useContext(LocaleContext);

  if (locale_context === null) {
    throw new Error("useI18n must be used inside LocaleProvider");
  }
  return locale_context;
}

export type { LocaleKey };
