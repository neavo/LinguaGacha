import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { en_us_messages } from '@/i18n/resources/en-US'
import { zh_cn_messages } from '@/i18n/resources/zh-CN'
import { LOCALE_VALUES, type Locale, type LocaleMessageSchema } from '@/i18n/types'

const LOCALE_STORAGE_KEY = 'lg-locale'
const DEFAULT_LOCALE: Locale = 'zh-CN'

type JoinPath<prefix extends string, key extends string> = prefix extends '' ? key : `${prefix}.${key}`

type NestedMessageKey<tree, prefix extends string = ''> = {
  [key in keyof tree & string]:
    tree[key] extends string
      ? JoinPath<prefix, key>
      : tree[key] extends object
        ? NestedMessageKey<tree[key], JoinPath<prefix, key>>
        : never
}[keyof tree & string]

type LocaleMessages = LocaleMessageSchema<typeof zh_cn_messages>
export type LocaleKey = NestedMessageKey<LocaleMessages>

type LocaleContextValue = {
  locale: Locale
  set_locale: (locale: Locale) => void
  toggle_locale: () => void
  t: (key: LocaleKey) => string
}

const LOCALE_SET: ReadonlySet<Locale> = new Set(LOCALE_VALUES)
const LocaleContext = createContext<LocaleContextValue | null>(null)

// 统一在入口层兜底非法 locale，避免资源读取分散处理分支。
function resolve_locale(candidate: string | null): Locale {
  if (candidate !== null && LOCALE_SET.has(candidate as Locale)) {
    return candidate as Locale
  } else {
    return DEFAULT_LOCALE
  }
}

function read_stored_locale(): Locale {
  try {
    const stored_locale = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored_locale !== null) {
      return resolve_locale(stored_locale)
    } else {
      return read_browser_locale()
    }
  } catch {
    return DEFAULT_LOCALE
  }
}

function read_browser_locale(): Locale {
  if (typeof window.navigator.language === 'string') {
    return resolve_locale(window.navigator.language)
  } else {
    return DEFAULT_LOCALE
  }
}

function write_stored_locale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // 本地存储不可用时保持内存态即可，界面不需要为此中断。
  }
}

function flatten_message_map(
  message_tree: Record<string, unknown>,
  message_map: Map<string, string>,
  path_prefix: string,
): void {
  for (const [entry_key, entry_value] of Object.entries(message_tree)) {
    const next_path = path_prefix === '' ? entry_key : `${path_prefix}.${entry_key}`

    if (typeof entry_value === 'string') {
      message_map.set(next_path, entry_value)
    } else if (typeof entry_value === 'object' && entry_value !== null) {
      flatten_message_map(entry_value as Record<string, unknown>, message_map, next_path)
    }
  }
}

function build_message_map(messages: LocaleMessages): ReadonlyMap<LocaleKey, string> {
  const message_map: Map<string, string> = new Map()
  flatten_message_map(messages as Record<string, unknown>, message_map, '')
  return message_map as ReadonlyMap<LocaleKey, string>
}

function read_message_value(message_map: ReadonlyMap<LocaleKey, string>, key: LocaleKey): string {
  const message_value = message_map.get(key)

  if (message_value !== undefined) {
    return message_value
  } else {
    return key
  }
}

const MESSAGE_MAP_BY_LOCALE: Readonly<Record<Locale, ReadonlyMap<LocaleKey, string>>> = {
  'zh-CN': build_message_map(zh_cn_messages),
  'en-US': build_message_map(en_us_messages),
}

export function LocaleProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, set_locale_state] = useState<Locale>(() => read_stored_locale())
  const message_map = MESSAGE_MAP_BY_LOCALE[locale]

  useEffect(() => {
    write_stored_locale(locale)
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.setAttribute('data-locale', locale)
  }, [locale])

  const context_value: LocaleContextValue = {
    locale,
    set_locale: set_locale_state,
    toggle_locale: () => {
      set_locale_state((previous_locale) => {
        if (previous_locale === 'zh-CN') {
          return 'en-US'
        } else {
          return 'zh-CN'
        }
      })
    },
    t: (key) => read_message_value(message_map, key),
  }

  return createElement(LocaleContext.Provider, { value: context_value }, children)
}

export function useI18n(): LocaleContextValue {
  const locale_context = useContext(LocaleContext)

  if (locale_context !== null) {
    return locale_context
  } else {
    throw new Error('useI18n must be used inside LocaleProvider')
  }
}
