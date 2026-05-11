// 文本保护模式是公开 meta、页面状态和规则执行共同使用的稳定值域。
export const TEXT_PRESERVE_MODES = ["off", "smart", "custom"] as const;

// QualityRuleType 是公开 quality section 的 key，不能暴露数据库旧物理命名。
export const QUALITY_RULE_TYPES = [
  "glossary",
  "text_preserve",
  "pre_replacement",
  "post_replacement",
] as const;

export type TextPreserveMode = (typeof TEXT_PRESERVE_MODES)[number];
export type QualityRuleType = (typeof QUALITY_RULE_TYPES)[number];

export type QualityRuleDatabaseType =
  | "glossary"
  | "text_preserve"
  | "pre_translation_replacement"
  | "post_translation_replacement";

export type QualityRulePresetDirectory =
  | "glossary"
  | "text_preserve"
  | "pre_translation_replacement"
  | "post_translation_replacement";

// QUALITY_RULE_MODEL 是公开 key 到数据库、预设目录和 meta 的唯一映射表。
export const QUALITY_RULE_MODEL = {
  glossary: {
    database_type: "glossary",
    preset_directory: "glossary",
    enabled_meta_key: "glossary_enable",
    revision_meta_key: "quality_rule_revision.glossary",
    default_mode: "off",
  },
  text_preserve: {
    database_type: "text_preserve",
    preset_directory: "text_preserve",
    enabled_meta_key: null,
    revision_meta_key: "quality_rule_revision.text_preserve",
    default_mode: "off",
  },
  pre_replacement: {
    database_type: "pre_translation_replacement",
    preset_directory: "pre_translation_replacement",
    enabled_meta_key: "pre_translation_replacement_enable",
    revision_meta_key: "quality_rule_revision.pre_replacement",
    default_mode: "off",
  },
  post_replacement: {
    database_type: "post_translation_replacement",
    preset_directory: "post_translation_replacement",
    enabled_meta_key: "post_translation_replacement_enable",
    revision_meta_key: "quality_rule_revision.post_replacement",
    default_mode: "off",
  },
} as const satisfies Record<
  QualityRuleType,
  {
    database_type: QualityRuleDatabaseType;
    preset_directory: QualityRulePresetDirectory;
    enabled_meta_key: string | null;
    revision_meta_key: string;
    default_mode: TextPreserveMode;
  }
>;

const TEXT_PRESERVE_MODE_SET = new Set<TextPreserveMode>(TEXT_PRESERVE_MODES);
const QUALITY_RULE_TYPE_SET = new Set<QualityRuleType>(QUALITY_RULE_TYPES);

// 文本保护模式来自 meta 和页面状态，进入规则执行前先收窄。
export function is_text_preserve_mode(value: unknown): value is TextPreserveMode {
  return TEXT_PRESERVE_MODE_SET.has(value as TextPreserveMode);
}

// 旧配置可能保存大写模式名，归一化后再决定是否启用保护。
export function normalize_text_preserve_mode(value: unknown): TextPreserveMode {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return is_text_preserve_mode(normalized) ? normalized : "off";
}

// 公开 quality section 的 key 不等同于 rules 表物理类型。
export function is_quality_rule_type(value: unknown): value is QualityRuleType {
  return QUALITY_RULE_TYPE_SET.has(value as QualityRuleType);
}

// 未知质量规则类型必须在写入口失败，避免落库后形成新物理分组。
export function normalize_quality_rule_type(value: unknown): QualityRuleType {
  if (is_quality_rule_type(value)) {
    return value;
  }
  throw new Error(`未知的质量规则类型：${String(value)}`);
}

export function resolve_quality_rule_database_type(
  rule_type: QualityRuleType,
): QualityRuleDatabaseType {
  return QUALITY_RULE_MODEL[rule_type].database_type;
}

// text_preserve 没有独立启用开关，返回 null 让调用点显式分支。
export function resolve_quality_rule_enabled_meta_key(rule_type: QualityRuleType): string | null {
  return QUALITY_RULE_MODEL[rule_type].enabled_meta_key;
}

// revision key 进入 ProjectStore patch，必须和公开 rule_type 保持一一对应。
export function build_quality_rule_revision_key(rule_type: QualityRuleType): string {
  return QUALITY_RULE_MODEL[rule_type].revision_meta_key;
}
