import type { JsonRecord } from "../shared/utils/json-tool";
import { UnknownQualityRuleTypeError, UnsupportedQualityRuleMetaError } from "../shared/error";

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
  store_key: QualityRuleKind; // 渲染进程质量切片的公开 key
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
    store_key: "glossary",
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
    store_key: "text_preserve",
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
    store_key: "pre_replacement",
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
    store_key: "post_replacement",
    preset_extension: ".json",
    default_enabled: false,
    default_mode: "off",
  },
} as const satisfies Record<QualityRuleKind, QualityRuleModel>;

const TEXT_PRESERVE_MODE_SET = new Set<TextPreserveMode>(TEXT_PRESERVE_MODES);
const QUALITY_RULE_KIND_SET = new Set<QualityRuleKind>(QUALITY_RULE_KINDS);

/**
 * QualityRule 是质量规则槽位实体，统一派生数据库类型、预设目录、meta key 和 store key
 */
export class QualityRule {
  public readonly kind: QualityRuleKind; // 质量规则槽位类型

  private constructor(kind: QualityRuleKind) {
    this.kind = kind;
  }

  /**
   * 反序列化公开 kind 或 rule_type 字段，拒绝未知规则防止落库形成新分组
   */
  public static from_json(payload: unknown): QualityRule {
    if (is_quality_rule_kind(payload)) {
      return new QualityRule(payload);
    }
    const record = read_record(payload);
    const value = record["kind"] ?? record["rule_type"] ?? record["type"];
    if (is_quality_rule_kind(value)) {
      return new QualityRule(value);
    }
    throw new UnknownQualityRuleTypeError(value);
  }

  /**
   * 固定枚举所有质量规则槽位，项目数据读取和默认空态都从这里生成
   */
  public static all(): QualityRule[] {
    return QUALITY_RULE_KINDS.map((kind) => new QualityRule(kind));
  }

  /**
   * 输出公开 kind，跨层不传 class 实例
   */
  public to_json(): JsonRecord {
    return { kind: this.kind };
  }

  /**
   * rules 表物理类型只从 QualityRule 派生
   */
  public get database_type(): QualityRuleDatabaseType {
    return QUALITY_RULE_MODEL[this.kind].database_type;
  }

  /**
   * 预设目录只从 QualityRule 派生，公开 API 不接收物理目录名
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
   * 默认预设 setting key 由规则槽位唯一决定
   */
  public get default_preset_setting_key(): string {
    return QUALITY_RULE_MODEL[this.kind].default_preset_setting_key;
  }

  /**
   * 公开存储键名是渲染进程质量切片的稳定字段名
   */
  public get store_key(): QualityRuleKind {
    return QUALITY_RULE_MODEL[this.kind].store_key;
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
   * 将页面、导入文件或旧工程中的规则条目归一为数据库可写形状
   */
  public static normalize_entry(entry: unknown): JsonRecord {
    const record = read_record(entry);
    const normalized_entry: JsonRecord = {
      src: String(record["src"] ?? "").trim(),
      dst: String(record["dst"] ?? "").trim(),
      info: String(record["info"] ?? "").trim(),
      regex: Boolean(record["regex"] ?? false),
      case_sensitive: Boolean(record["case_sensitive"] ?? false),
    };
    const entry_id = String(record["entry_id"] ?? "").trim();
    if (entry_id !== "") {
      normalized_entry["entry_id"] = entry_id;
    }
    return normalized_entry;
  }

  /**
   * 规则列表写入数据库前过滤坏项和空 src，保持 CRUD 与预设导入一致
   */
  public static normalize_entries(value: unknown): JsonRecord[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const result: JsonRecord[] = [];
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const normalized = QualityRule.normalize_entry(entry);
      if (normalized["src"] !== "") {
        result.push(normalized);
      }
    }
    return result;
  }

  /**
   * 项目 query 消费 quality slice 时复用同一 entries / meta / revision 口径
   */
  public normalize_slice(value: unknown): {
    entries: JsonRecord[];
    enabled: boolean;
    mode: TextPreserveMode;
    revision: number;
  } {
    const record = read_record(value);
    return {
      entries: Array.isArray(record["entries"])
        ? record["entries"].flatMap((entry) => {
            return typeof entry === "object" && entry !== null && !Array.isArray(entry)
              ? [{ ...(entry as JsonRecord) }]
              : [];
          })
        : [],
      enabled: this.normalize_enabled(record["enabled"]),
      mode: this.normalize_mode(record["mode"]),
      revision: Number(record["revision"] ?? 0),
    };
  }

  /**
   * 质量规则启用态缺字段时按槽位默认值归一，避免各运行时自行猜布尔值
   */
  public normalize_enabled(value: unknown): boolean {
    return normalize_boolean_meta_value(value, this.default_enabled);
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
        throw new UnsupportedQualityRuleMetaError(this.kind, key);
      }
      return this.enabled_meta_key;
    }
    if (key === "mode" && this.mode_meta_key !== null) {
      return this.mode_meta_key;
    }
    throw new UnsupportedQualityRuleMetaError(this.kind, key);
  }

  /**
   * 归一页面 meta 值，兼容旧项目缺失字段
   */
  public normalize_meta_value(key: string, value: unknown): boolean | TextPreserveMode | unknown {
    if (key === "enabled") {
      return normalize_boolean_meta_value(value, false);
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

export function is_quality_rule_kind(value: unknown): value is QualityRuleKind {
  return QUALITY_RULE_KIND_SET.has(value as QualityRuleKind);
}

function read_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function normalize_boolean_meta_value(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return fallback;
}
