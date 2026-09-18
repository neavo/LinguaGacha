import { createElement, useEffect, useMemo, type ReactNode } from "react";
import { create_text_resolver, type Locale } from "@shared/i18n";
import { type LocaleContextValue, LocaleContext } from "./locale-context";

type LocaleProviderProps = {
  locale: Locale;
  children: ReactNode;
};

/** 消费窗口已解析的语言，同步文案解析器与页面语言标记。 */
export function LocaleProvider({ locale, children }: LocaleProviderProps): ReactNode {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("data-locale", locale);
  }, [locale]);

  const t = useMemo(() => create_text_resolver(locale), [locale]);

  // 原因：文案函数会进入很多页面级 callback/effect 的依赖数组，这里必须稳定引用，避免页面在静置时持续重复刷新
  const context_value = useMemo<LocaleContextValue>(() => {
    return {
      locale,
      t,
    };
  }, [locale, t]);

  return createElement(LocaleContext.Provider, { value: context_value }, children);
}
