import { Type, type Static } from "typebox";
import { Check, Errors } from "typebox/value";
import { read_json_boolean, type JsonRecord } from "./json";
import { AppError } from "../shared/error/app-error";

const glossary_fields = {
  src: Type.String({ pattern: "\\S" }), // 在条目原文中匹配的术语，至少含一个非空白字符。
  dst: Type.String(), // 在对应译文中检查应用的术语译文。
  info: Type.String(), // 提示词和页面使用的术语说明。
  case_sensitive: Type.Boolean(), // 术语原文匹配是否区分大小写。
};
const replacement_fields = {
  src: glossary_fields.src, // 字面量或正则源模式。
  dst: glossary_fields.dst, // 规则命中后的替换文本。
  regex: Type.Boolean(), // 是否使用正则匹配与替换语义。
  case_sensitive: glossary_fields.case_sensitive, // 字面量和正则匹配的大小写策略。
};
export const QUALITY_RULE_BUSINESS_SCHEMAS = {
  glossary: Type.Object(glossary_fields),
  text_preserve: Type.Object({
    src: glossary_fields.src, // 自定义文本保护的正则源模式。
    info: glossary_fields.info, // 用户说明，不参与匹配。
  }),
  pre_replacement: Type.Object(replacement_fields),
  post_replacement: Type.Object(replacement_fields),
};
const optional_identity = { entry_id: Type.Optional(Type.String()) }; // 规则输入可省略项目身份。
const identity = { entry_id: Type.String({ minLength: 1 }) }; // 项目规则必须携带非空的稳定身份。
const GLOSSARY_ENTRY_SCHEMA = Type.Object({ ...glossary_fields, ...optional_identity });
const TEXT_PRESERVE_ENTRY_SCHEMA = Type.Object({
  ...QUALITY_RULE_BUSINESS_SCHEMAS.text_preserve.properties,
  ...optional_identity,
});
const TEXT_REPLACEMENT_ENTRY_SCHEMA = Type.Object({
  ...replacement_fields,
  ...optional_identity,
});
const QUALITY_RULE_ENTRY_SCHEMAS = {
  glossary: Type.Object({ ...glossary_fields, ...identity }),
  text_preserve: Type.Object({
    ...QUALITY_RULE_BUSINESS_SCHEMAS.text_preserve.properties,
    ...identity,
  }),
  pre_replacement: Type.Object({ ...replacement_fields, ...identity }),
  post_replacement: Type.Object({ ...replacement_fields, ...identity }),
};
const QUALITY_RULE_INPUT_SCHEMAS = {
  glossary: GLOSSARY_ENTRY_SCHEMA,
  text_preserve: TEXT_PRESERVE_ENTRY_SCHEMA,
  pre_replacement: TEXT_REPLACEMENT_ENTRY_SCHEMA,
  post_replacement: TEXT_REPLACEMENT_ENTRY_SCHEMA,
};
export type GlossaryEntry = Static<typeof GLOSSARY_ENTRY_SCHEMA>;
export type TextPreserveEntry = Static<typeof TEXT_PRESERVE_ENTRY_SCHEMA>;
export type TextReplacementEntry = Static<typeof TEXT_REPLACEMENT_ENTRY_SCHEMA>;
export type QualityRuleEntryByKind = {
  [Kind in keyof typeof QUALITY_RULE_ENTRY_SCHEMAS]: Static<
    (typeof QUALITY_RULE_ENTRY_SCHEMAS)[Kind]
  >;
};
export type QualityRuleGlossaryEntry = QualityRuleEntryByKind["glossary"];
export type QualityRuleTextPreserveEntry = QualityRuleEntryByKind["text_preserve"];
export type QualityRuleTextReplacementEntry = QualityRuleEntryByKind["pre_replacement"];
export type QualityRuleEntryInput = Static<
  (typeof QUALITY_RULE_INPUT_SCHEMAS)[keyof typeof QUALITY_RULE_INPUT_SCHEMAS]
>;

/** src 必填，其余业务字段在预设和历史读取边界补齐。 */
const replacement_defaults = { dst: "", regex: false, case_sensitive: false };
const QUALITY_RULE_DEFAULT_FIELDS = {
  glossary: { dst: "", info: "", case_sensitive: false },
  text_preserve: { info: "" },
  pre_replacement: replacement_defaults,
  post_replacement: replacement_defaults,
} satisfies {
  [Kind in keyof typeof QUALITY_RULE_BUSINESS_SCHEMAS]: Omit<
    Static<(typeof QUALITY_RULE_BUSINESS_SCHEMAS)[Kind]>,
    "src"
  >;
};

export const TEXT_PRESERVE_MODES = ["off", "smart", "custom"] as const; // 文本保护模式是公开 meta、页面状态和规则执行共同使用的稳定值域

// 质量规则类型是公开质量切片的 key，不能暴露数据库旧物理命名
export const QUALITY_RULE_KINDS = [
  "glossary",
  "text_preserve",
  "pre_replacement",
  "post_replacement",
] as const;

export type TextPreserveMode = (typeof TEXT_PRESERVE_MODES)[number];
export type QualityRuleKind = (typeof QUALITY_RULE_KINDS)[number];

export type QualityRuleEntry = QualityRuleEntryByKind[QualityRuleKind];

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

type QualityRuleModel = {
  database_type: QualityRuleDatabaseType; // rules 表物理类型
  preset_directory: QualityRulePresetDirectory; // 预设目录名
  enabled_meta_key: string | null; // 启用开关 meta key
  mode_meta_key: "text_preserve_mode" | null; // 文本保护模式 meta key
  revision_meta_key: string; // revision meta key
  default_preset_setting_key:
    | "glossary_default_preset"
    | "text_preserve_default_preset"
    | "pre_translation_replacement_default_preset"
    | "post_translation_replacement_default_preset"; // 默认预设 setting key
  preset_extension: ".json"; // 质量规则预设扩展名
  default_enabled: boolean; // 缺失启用 meta 时使用的领域默认值
  default_mode: TextPreserveMode; // 默认文本保护模式
};

const QUALITY_RULE_MODEL = {
  glossary: {
    database_type: "glossary",
    preset_directory: "glossary",
    enabled_meta_key: "glossary_enable",
    mode_meta_key: null,
    revision_meta_key: "quality_rule_revision.glossary",
    default_preset_setting_key: "glossary_default_preset",
    preset_extension: ".json",
    default_enabled: true,
    default_mode: "off",
  },
  text_preserve: {
    database_type: "text_preserve",
    preset_directory: "text_preserve",
    enabled_meta_key: null,
    mode_meta_key: "text_preserve_mode",
    revision_meta_key: "quality_rule_revision.text_preserve",
    default_preset_setting_key: "text_preserve_default_preset",
    preset_extension: ".json",
    default_enabled: false,
    default_mode: "smart",
  },
  pre_replacement: {
    database_type: "pre_translation_replacement",
    preset_directory: "pre_translation_replacement",
    enabled_meta_key: "pre_translation_replacement_enable",
    mode_meta_key: null,
    revision_meta_key: "quality_rule_revision.pre_replacement",
    default_preset_setting_key: "pre_translation_replacement_default_preset",
    preset_extension: ".json",
    default_enabled: false,
    default_mode: "off",
  },
  post_replacement: {
    database_type: "post_translation_replacement",
    preset_directory: "post_translation_replacement",
    enabled_meta_key: "post_translation_replacement_enable",
    mode_meta_key: null,
    revision_meta_key: "quality_rule_revision.post_replacement",
    default_preset_setting_key: "post_translation_replacement_default_preset",
    preset_extension: ".json",
    default_enabled: false,
    default_mode: "off",
  },
} as const satisfies Record<QualityRuleKind, QualityRuleModel>;

const TEXT_PRESERVE_MODE_SET = new Set<TextPreserveMode>(TEXT_PRESERVE_MODES);
const QUALITY_RULE_KIND_SET = new Set<QualityRuleKind>(QUALITY_RULE_KINDS);

/**
 * QualityRule 是质量规则槽位实体，统一计算数据库类型、预设目录和 meta key。
 */
export class QualityRule<K extends QualityRuleKind = QualityRuleKind> {
  public readonly kind: K; // 质量规则槽位类型

  /** 固定已经校验的规则类型，字段映射统一由领域对象提供。 */
  private constructor(kind: K) {
    this.kind = kind;
  }

  /**
   * 反序列化公开 kind 或 rule_type 字段，拒绝未知规则防止落库形成新分组
   */
  public static from_json<K extends QualityRuleKind>(payload: K): QualityRule<K>;
  public static from_json(payload: unknown): QualityRule;
  public static from_json(payload: unknown): QualityRule {
    if (is_quality_rule_kind(payload)) {
      return new QualityRule(payload);
    }
    const record = read_record(payload);
    const value = record["kind"] ?? record["rule_type"] ?? record["type"];
    if (is_quality_rule_kind(value)) {
      return new QualityRule(value);
    }
    throw new AppError("quality.unknown_rule_type", {
      diagnostic_context: { value: String(value) },
    });
  }

  /**
   * 固定枚举所有质量规则槽位，项目数据读取和默认空态都从这里生成
   */
  public static all(): QualityRule[] {
    return QUALITY_RULE_KINDS.map((kind) => new QualityRule(kind));
  }

  /**
   * rules 表物理类型只从 QualityRule 计算
   */
  public get database_type(): QualityRuleDatabaseType {
    return QUALITY_RULE_MODEL[this.kind].database_type;
  }

  /**
   * 预设目录只从 QualityRule 计算，公开 API 不接收物理目录名
   */
  public get preset_directory(): QualityRulePresetDirectory {
    return QUALITY_RULE_MODEL[this.kind].preset_directory;
  }

  /**
   * text_preserve 没有独立启用开关，其它规则从这里读取 meta key
   */
  public get enabled_meta_key(): string | null {
    return QUALITY_RULE_MODEL[this.kind].enabled_meta_key;
  }

  /**
   * 只有 text_preserve 拥有 mode meta key
   */
  public get mode_meta_key(): string | null {
    return QUALITY_RULE_MODEL[this.kind].mode_meta_key;
  }

  /**
   * revision key 进入项目变更事件，必须和公开 kind 保持一一对应
   */
  public get revision_meta_key(): string {
    return QUALITY_RULE_MODEL[this.kind].revision_meta_key;
  }

  /**
   * 默认预设设置键由规则槽位唯一决定
   */
  public get default_preset_setting_key(): QualityRuleModel["default_preset_setting_key"] {
    return QUALITY_RULE_MODEL[this.kind].default_preset_setting_key;
  }

  /**
   * 质量规则预设固定为 json 文件
   */
  public get preset_extension(): ".json" {
    return QUALITY_RULE_MODEL[this.kind].preset_extension;
  }

  /**
   * 缺少 enabled meta 时由规则槽位决定默认启用态
   */
  public get default_enabled(): boolean {
    return QUALITY_RULE_MODEL[this.kind].default_enabled;
  }

  /**
   * 默认 mode 只用于质量规则空态和跨层输入缺字段归一
   */
  public get default_mode(): TextPreserveMode {
    return QUALITY_RULE_MODEL[this.kind].default_mode;
  }

  /**
   * 归一规则业务字段。项目身份由调用边界处理。
   */
  public normalize_entry(entry: unknown): QualityRuleEntryInput {
    const record = require_record(entry, "Quality rule entry must be an object.");
    const normalized: Record<string, unknown> = {};
    const defaults: JsonRecord = QUALITY_RULE_DEFAULT_FIELDS[this.kind];
    const schema = QUALITY_RULE_INPUT_SCHEMAS[this.kind];
    for (const field of Object.keys(schema.properties)) {
      const value = record[field] === undefined ? defaults[field] : record[field];
      if (value !== undefined) normalized[field] = typeof value === "string" ? value.trim() : value;
    }
    // 预设可省略项目身份，空身份沿用创建边界分配身份的语义。
    if (normalized["entry_id"] === "") delete normalized["entry_id"];
    if (!Check(schema, normalized)) {
      const error = Errors(schema, normalized)[0]!;
      const field =
        error.keyword === "required"
          ? error.params.requiredProperties[0]
          : error.instancePath.slice(1);
      const expected = Object.entries(schema.properties).find(([key]) => key === field)?.[1].type;
      throw new TypeError(
        error.keyword === "pattern"
          ? `Quality rule ${field} must not be empty.`
          : `Quality rule ${field} must be a ${expected}.`,
      );
    }
    return normalized;
  }

  /** 规则逐项归一。任一条目非法时整批失败。 */
  public normalize_entries(value: unknown): QualityRuleEntryInput[] {
    if (!Array.isArray(value)) throw new TypeError("Quality rule entries must be an array.");
    return value.map((entry) => this.normalize_entry(entry));
  }

  /**
   * 质量规则启用态缺字段时按槽位默认值归一，避免各运行时自行猜布尔值
   */
  public normalize_enabled(value: unknown): boolean {
    return read_json_boolean(value, this.default_enabled);
  }

  /**
   * 文本保护模式缺字段时按槽位默认值归一，其它规则固定为 off
   */
  public normalize_mode(value: unknown): TextPreserveMode {
    if (this.mode_meta_key === null) {
      return "off";
    }
    return normalize_text_preserve_mode(value, this.default_mode);
  }

  /**
   * 映射页面 meta key 到工程 meta key，保持规则类型命名唯一
   */
  public resolve_meta_key(key: string): string {
    if (key === "enabled") {
      if (this.enabled_meta_key === null) {
        throw new AppError("quality.unsupported_rule_meta", {
          diagnostic_context: { kind: this.kind, key },
        });
      }
      return this.enabled_meta_key;
    }
    if (key === "mode" && this.mode_meta_key !== null) {
      return this.mode_meta_key;
    }
    throw new AppError("quality.unsupported_rule_meta", {
      diagnostic_context: { kind: this.kind, key },
    });
  }

  /**
   * 归一页面 meta 值，兼容旧项目缺失字段
   */
  public normalize_meta_value(key: string, value: unknown): boolean | TextPreserveMode | unknown {
    if (key === "enabled") {
      return read_json_boolean(value, false);
    }
    if (key === "mode" && this.mode_meta_key !== null) {
      return normalize_text_preserve_mode(value);
    }
    return value;
  }
}

// 文本保护模式来自 meta 和页面状态，进入规则执行前先收窄
export function is_text_preserve_mode(value: unknown): value is TextPreserveMode {
  return TEXT_PRESERVE_MODE_SET.has(value as TextPreserveMode);
}

// 旧配置可能保存大写模式名，归一化后再决定是否启用保护
export function normalize_text_preserve_mode(
  value: unknown,
  fallback: TextPreserveMode = "off",
): TextPreserveMode {
  const normalized_value = read_record(value)["value"] ?? value;
  const normalized = String(normalized_value ?? "")
    .trim()
    .toLowerCase();
  return is_text_preserve_mode(normalized) ? normalized : fallback;
}

/** 校验公开规则类型，供边界输入收窄。 */
export function is_quality_rule_kind(value: unknown): value is QualityRuleKind {
  return QUALITY_RULE_KIND_SET.has(value as QualityRuleKind);
}

/** 可选对象缺失时返回空记录。 */
function read_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

/** 必填对象形状错误时中止解析。 */
function require_record(value: unknown, message: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
  return value as JsonRecord;
}
