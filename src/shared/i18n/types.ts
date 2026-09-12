// 设置编码沿用持久化值；顺序和语言自称同时供菜单及发行包消费。
export const APP_LANGUAGE_DEFINITIONS = [
  { code: "ZH", locale: "zh-CN", name: "中文" },
  { code: "JA", locale: "ja-JP", name: "日本語" },
  { code: "KO", locale: "ko-KR", name: "한국어" },
  { code: "EN", locale: "en-US", name: "English" },
  { code: "DE", locale: "de-DE", name: "Deutsch" },
] as const;

export type AppLanguage = (typeof APP_LANGUAGE_DEFINITIONS)[number]["code"];
export type Locale = (typeof APP_LANGUAGE_DEFINITIONS)[number]["locale"];
export const LOCALES: readonly Locale[] = APP_LANGUAGE_DEFINITIONS.map(({ locale }) => locale);

export type LocaleMessageSchema<tree> = {
  [key in keyof tree]: tree[key] extends string
    ? string
    : tree[key] extends object
      ? LocaleMessageSchema<tree[key]>
      : never;
};
