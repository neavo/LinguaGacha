/** `fill` 只填充未完成条目；`overwrite` 另外允许上下文一致的旧译文覆盖已完成条目。 */
export const TRANSLATION_INHERITANCE_MODES = ["fill", "overwrite"] as const;

export type TranslationInheritanceMode = (typeof TRANSLATION_INHERITANCE_MODES)[number];

/** 导入是否从工程已有条目填充译文，工作台导入与 AGENT 新增共用。 */
export const IMPORT_INHERITANCE_MODES = ["none", "inherit"] as const;

export type ImportInheritanceMode = (typeof IMPORT_INHERITANCE_MODES)[number];
