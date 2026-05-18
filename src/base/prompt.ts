import type { JsonRecord } from "../shared/utils/json-tool";
import { UnknownPromptTypeError } from "../shared/error";

export const PROMPT_KINDS = ["translation", "analysis"] as const; // 提示词只暴露翻译和分析两类任务，重翻复用翻译语义

export type PromptKind = (typeof PROMPT_KINDS)[number];
export type PromptDatabaseType = "translation_prompt" | "analysis_prompt";

type PromptModel = {
  database_type: PromptDatabaseType; // rules 表类型
  directory_name: "translation_prompt" | "analysis_prompt"; // 资源目录名
  enabled_meta_key: string; // 启用开关 meta key
  revision_meta_key: string; // revision meta key
  default_preset_setting_key:
    | "translation_custom_prompt_default_preset"
    | "analysis_custom_prompt_default_preset"; // 默认预设 setting key
  store_key: PromptKind; // renderer prompts section 的公开 key
  preset_extension: ".txt"; // 提示词预设扩展名
  template_files: readonly ["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"]; // 模板文件集合
};

const PROMPT_MODEL = {
  translation: {
    database_type: "translation_prompt",
    directory_name: "translation_prompt",
    enabled_meta_key: "translation_prompt_enable",
    revision_meta_key: "quality_prompt_revision.translation",
    default_preset_setting_key: "translation_custom_prompt_default_preset",
    store_key: "translation",
    preset_extension: ".txt",
    template_files: ["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"],
  },
  analysis: {
    database_type: "analysis_prompt",
    directory_name: "analysis_prompt",
    enabled_meta_key: "analysis_prompt_enable",
    revision_meta_key: "quality_prompt_revision.analysis",
    default_preset_setting_key: "analysis_custom_prompt_default_preset",
    store_key: "analysis",
    preset_extension: ".txt",
    template_files: ["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"],
  },
} as const satisfies Record<PromptKind, PromptModel>;

const PROMPT_KIND_SET = new Set<PromptKind>(PROMPT_KINDS);

/**
 * Prompt 是提示词槽位实体，统一派生目录、rules 表类型、meta key 和 ProjectStore key
 */
export class Prompt {
  public readonly kind: PromptKind; // 提示词槽位类型

  private constructor(kind: PromptKind) {
    this.kind = kind;
  }

  /**
   * 反序列化公开 kind 或旧 task_type 字段，服务层收到请求后立即收窄
   */
  public static from_json(payload: unknown): Prompt {
    if (is_prompt_kind(payload)) {
      return new Prompt(payload);
    }
    const record = read_record(payload);
    const value = record["kind"] ?? record["task_type"] ?? record["type"];
    if (is_prompt_kind(value)) {
      return new Prompt(value);
    }
    throw new UnknownPromptTypeError(value);
  }

  /**
   * 返回翻译提示词槽位，重翻任务也复用该语义
   */
  public static translation(): Prompt {
    return new Prompt("translation");
  }

  /**
   * 返回分析提示词槽位，供模板读取和规则文本写入复用同一实体
   */
  public static analysis(): Prompt {
    return new Prompt("analysis");
  }

  /**
   * 固定枚举所有提示词槽位，项目数据读取和默认空态都从这里生成
   */
  public static all(): Prompt[] {
    return PROMPT_KINDS.map((kind) => new Prompt(kind));
  }

  /**
   * 输出公开 kind，跨层不传 class 实例
   */
  public to_json(): JsonRecord {
    return { kind: this.kind };
  }

  /**
   * rules 表物理类型只从 Prompt 派生
   */
  public get database_type(): PromptDatabaseType {
    return PROMPT_MODEL[this.kind].database_type;
  }

  /**
   * 资源目录名只从 Prompt 派生，worker 和路径服务不再拼接字符串
   */
  public get directory_name(): string {
    return PROMPT_MODEL[this.kind].directory_name;
  }

  /**
   * 启用开关 meta key 与提示词槽位一一对应
   */
  public get enabled_meta_key(): string {
    return PROMPT_MODEL[this.kind].enabled_meta_key;
  }

  /**
   * revision key 进入 ProjectStore change，必须保持集中生成
   */
  public get revision_meta_key(): string {
    return PROMPT_MODEL[this.kind].revision_meta_key;
  }

  /**
   * 默认预设 setting key 只由提示词槽位决定
   */
  public get default_preset_setting_key(): string {
    return PROMPT_MODEL[this.kind].default_preset_setting_key;
  }

  /**
   * store_key 是 renderer prompts section 的公开 key
   */
  public get store_key(): PromptKind {
    return PROMPT_MODEL[this.kind].store_key;
  }

  /**
   * 提示词预设固定为 txt 文件
   */
  public get preset_extension(): ".txt" {
    return PROMPT_MODEL[this.kind].preset_extension;
  }

  /**
   * 模板文件集合由 Prompt 维护，PromptBuilder 只读取实体派生结果
   */
  public get template_files(): readonly ["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"] {
    return PROMPT_MODEL[this.kind].template_files;
  }

  /**
   * ProjectStore 消费提示词 slice 时只接受公开顶层字段口径
   */
  public normalize_slice(value: unknown): { text: string; enabled: boolean; revision: number } {
    const record = read_record(value);
    return {
      text: String(record["text"] ?? ""),
      enabled: Boolean(record["enabled"]),
      revision: Number(record["revision"] ?? 0),
    };
  }
}

export function is_prompt_kind(value: unknown): value is PromptKind {
  return PROMPT_KIND_SET.has(value as PromptKind);
}

function read_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
