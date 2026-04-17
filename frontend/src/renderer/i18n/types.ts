export const LOCALE_VALUES = ['zh-CN', 'en-US'] as const

export type Locale = (typeof LOCALE_VALUES)[number]

export type LocaleMessageSchema<tree> = {
  [key in keyof tree]: tree[key] extends string
    ? string
    : tree[key] extends object
      ? LocaleMessageSchema<tree[key]>
      : never
}
