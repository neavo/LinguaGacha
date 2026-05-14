import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { useDesktopRuntime } from "@/app/desktop/use-desktop-runtime";
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

export function LocaleProvider({ children }: { children: ReactNode }): ReactNode {
  const { settings_snapshot } = useDesktopRuntime();
  const locale = useMemo<Locale>(() => {
    return resolve_i18n_locale(settings_snapshot.app_language);
  }, [settings_snapshot.app_language]);

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
