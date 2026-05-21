import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import {
  create_text_resolver,
  resolve_i18n_locale,
  type Locale,
  type LocaleKey,
} from "@shared/i18n";

type LocaleContextValue = {
  locale: Locale;
  t: (key: LocaleKey, params?: Record<string, string>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

type LocaleProviderProps = {
  app_language: unknown;
  children: ReactNode;
};

export function LocaleProvider({ app_language, children }: LocaleProviderProps): ReactNode {
  // LocaleProvider 只消费调用方传入的语言值，避免 i18n 反向绑定某一种窗口运行态
  const locale = useMemo<Locale>(() => {
    return resolve_i18n_locale(app_language);
  }, [app_language]);

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

export function useI18n(): LocaleContextValue {
  const locale_context = useContext(LocaleContext);

  if (locale_context !== null) {
    return locale_context;
  } else {
    throw new Error("useI18n must be used inside LocaleProvider");
  }
}

export type { LocaleKey };
