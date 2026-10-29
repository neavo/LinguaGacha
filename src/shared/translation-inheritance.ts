/** `fill` 只填充未完成条目；`overwrite` 另外允许上下文一致的旧译文覆盖已完成条目。 */
export const TRANSLATION_INHERITANCE_MODES = ["fill", "overwrite"] as const;

export type TranslationInheritanceMode = (typeof TRANSLATION_INHERITANCE_MODES)[number];
