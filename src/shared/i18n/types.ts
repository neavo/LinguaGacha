export const LOCALES = ["zh-CN", "en-US", "de-DE"] as const;

export type Locale = (typeof LOCALES)[number];

export type LocaleMessageSchema<tree> = {
  [key in keyof tree]: tree[key] extends string
    ? string
    : tree[key] extends object
      ? LocaleMessageSchema<tree[key]>
      : never;
};
