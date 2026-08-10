import type { JsonRecord } from "./json";
import { read_json_record } from "./json";
import {
  resolve_model_agent_config,
  type ModelAgentConfig,
  type ModelAgentLimits,
} from "./model-agent";

// 模型类型是设置文件、模型页分组和服务端模板选择共享的稳定值域。
const MODEL_TYPE_DEFINITIONS = {
  PRESET: { sort_order: 0, template_filename: null },
  CUSTOM_GOOGLE: { sort_order: 1, template_filename: "preset_model_custom_google.json" },
  CUSTOM_OPENAI: { sort_order: 2, template_filename: "preset_model_custom_openai.json" },
  CUSTOM_OPENAI_RESPONSES: {
    sort_order: 3,
    template_filename: "preset_model_custom_openai_responses.json",
  },
  CUSTOM_ANTHROPIC: { sort_order: 4, template_filename: "preset_model_custom_anthropic.json" },
} as const;

export type ModelType = keyof typeof MODEL_TYPE_DEFINITIONS;
export type CustomModelType = Exclude<ModelType, "PRESET">;

/** 排序、模板补齐和模型页展示共用同一份类型定义。 */
export const MODEL_TYPES: readonly ModelType[] = Object.freeze(
  (Object.keys(MODEL_TYPE_DEFINITIONS) as ModelType[]).sort(
    (left, right) =>
      MODEL_TYPE_DEFINITIONS[left].sort_order - MODEL_TYPE_DEFINITIONS[right].sort_order,
  ),
);

/** 配置、API 与运行时共用的模型执行用途。 */
export const MODEL_USAGES = ["translation", "analysis", "agent"] as const;

export const MODEL_API_FORMATS = [
  "OpenAI",
  "OpenAIResponses",
  "SakuraLLM",
  "Google",
  "Anthropic",
] as const; // API 格式同时影响连通性测试、LLM adapter 和请求 payload 兼容策略

export const MODEL_THINKING_LEVELS = ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"] as const; // thinking 档位只在支持推理的模型上生效，但快照值域保持统一

export type ModelUsage = (typeof MODEL_USAGES)[number];
/** 每种执行用途当前选择的模型 ID。 */
export type ModelSelection = Record<ModelUsage, string>;
export type ModelApiFormat = (typeof MODEL_API_FORMATS)[number];
export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];

type ModelRequestConfig = {
  extra_headers: JsonRecord; // 请求层额外 headers
  extra_headers_custom_enable: boolean; // 是否启用自定义 headers
  extra_body: JsonRecord; // 请求层额外 body
  extra_body_custom_enable: boolean; // 是否启用自定义 body
};

type ModelThresholdConfig = {
  input_token_limit: number; // 输入 token 限制
  output_token_limit: number; // 输出 token 限制
  rpm_limit: number; // 每分钟请求数限制，0 表示不限制
  concurrency_limit: number; // 并发限制，0 表示沿用全局策略
};

type ModelThinkingConfig = {
  level: ModelThinkingLevel; // 思考挡位
};

type ModelGenerationConfig = {
  temperature: number; // 温度
  temperature_custom_enable: boolean; // 是否启用自定义温度
  top_p: number; // Top P
  top_p_custom_enable: boolean; // 是否启用自定义 Top P
};

const MODEL_TYPE_SET = new Set<ModelType>(MODEL_TYPES);
const MODEL_API_FORMAT_SET = new Set<ModelApiFormat>(MODEL_API_FORMATS);
const MODEL_THINKING_LEVEL_SET = new Set<ModelThinkingLevel>(MODEL_THINKING_LEVELS);

const DEFAULT_REQUEST_CONFIG: ModelRequestConfig = {
  extra_headers: {},
  extra_headers_custom_enable: false,
  extra_body: {},
  extra_body_custom_enable: false,
};

const DEFAULT_THRESHOLD_CONFIG: ModelThresholdConfig = {
  input_token_limit: 512,
  output_token_limit: 4096,
  rpm_limit: 0,
  concurrency_limit: 0,
};

const DEFAULT_THINKING_CONFIG: ModelThinkingConfig = {
  level: "OFF",
};

const DEFAULT_GENERATION_CONFIG: ModelGenerationConfig = {
  temperature: 0.95,
  temperature_custom_enable: false,
  top_p: 0.95,
  top_p_custom_enable: false,
};

/**
 * Model 是模型页、设置文件和任务 worker 共享的模型配置实体
 */
export class Model {
  public readonly id: string; // 模型 ID
  public readonly type: ModelType; // 模型类型
  public readonly name: string; // 模型名称
  public readonly api_format: ModelApiFormat; // API 格式
  public readonly api_url: string; // API 地址
  public readonly api_key: string; // API Key
  public readonly model_id: string; // 服务商模型 ID
  public readonly agent: ModelAgentConfig; // 0 表示自动的 Agent 容量配置
  public readonly agent_limits: ModelAgentLimits; // 按模型 ID 解析后的实际容量
  public readonly request: ModelRequestConfig; // 请求层配置快照
  public readonly threshold: ModelThresholdConfig; // 阈值配置快照
  public readonly thinking: ModelThinkingConfig; // 思考挡位配置快照
  public readonly generation: ModelGenerationConfig; // 生成参数配置快照

  private constructor(fields: {
    id: string;
    type: ModelType;
    name: string;
    api_format: ModelApiFormat;
    api_url: string;
    api_key: string;
    model_id: string;
    agent: ModelAgentConfig;
    agent_limits: ModelAgentLimits;
    request: ModelRequestConfig;
    threshold: ModelThresholdConfig;
    thinking: ModelThinkingConfig;
    generation: ModelGenerationConfig;
  }) {
    this.id = fields.id;
    this.type = fields.type;
    this.name = fields.name;
    this.api_format = fields.api_format;
    this.api_url = fields.api_url;
    this.api_key = fields.api_key;
    this.model_id = fields.model_id;
    this.agent = fields.agent;
    this.agent_limits = fields.agent_limits;
    this.request = fields.request;
    this.threshold = fields.threshold;
    this.thinking = fields.thinking;
    this.generation = fields.generation;
  }

  /**
   * 从设置文件、预设模板或页面 patch 反序列化模型，统一补齐嵌套配置默认值
   */
  public static from_json(payload: unknown, fallback_id: string): Model {
    const record = read_json_model_record(payload);
    const model_id = String(record["model_id"] ?? "");
    const resolved_agent = resolve_model_agent_config(model_id, record["agent"]);
    return new Model({
      id: String(record["id"] ?? fallback_id),
      type: Model.normalize_type(record["type"]),
      name: String(record["name"] ?? ""),
      api_format: Model.normalize_api_format(record["api_format"]),
      api_url: String(record["api_url"] ?? ""),
      api_key: String(record["api_key"] ?? "no_key_required"),
      model_id,
      agent: resolved_agent.config,
      agent_limits: resolved_agent.limits,
      request: Model.normalize_request_config(record["request"]),
      threshold: Model.normalize_threshold_config(record["threshold"]),
      thinking: Model.normalize_thinking_config(record["thinking"]),
      generation: Model.normalize_generation_config(record["generation"]),
    });
  }

  /** 输出与领域对象脱离引用的模型设置 JSON，供跨进程和任务 worker 消费。 */
  public to_json(): JsonRecord {
    return structuredClone({
      id: this.id,
      type: this.type,
      name: this.name,
      api_format: this.api_format,
      api_url: this.api_url,
      api_key: this.api_key,
      model_id: this.model_id,
      agent: this.agent,
      request: this.request,
      threshold: this.threshold,
      thinking: this.thinking,
      generation: this.generation,
    }) as JsonRecord;
  }

  /**
   * 自定义模型才拥有模板文件，预设模型直接来自内置列表
   */
  public template_filename(): string | null {
    return Model.resolve_template_filename(this.type);
  }

  /**
   * 自定义模型可编辑、可删除并拥有模板文件，内置预设只允许重置
   */
  public is_custom(): boolean {
    return Model.is_custom_type(this.type);
  }

  /**
   * 预设模型来自内置资源，只允许重置，不允许删除
   */
  public is_preset(): boolean {
    return this.type === "PRESET";
  }

  /**
   * 模型配置从磁盘和页面表单进入时先收窄到稳定类型
   */
  public static normalize_type(value: unknown): ModelType {
    return is_model_type(value) ? value : "PRESET";
  }

  /**
   * 未知 API 格式回退 OpenAI 兼容协议，这是现有自定义模型的默认路径
   */
  public static normalize_api_format(value: unknown): ModelApiFormat {
    return is_model_api_format(value) ? value : "OpenAI";
  }

  /**
   * 旧模型配置缺失 thinking 时按关闭推理处理
   */
  public static normalize_thinking_level(value: unknown): ModelThinkingLevel {
    return is_model_thinking_level(value) ? value : "OFF";
  }

  /**
   * 未知类型排在最后，模型页排序不因脏数据抛错
   */
  public static resolve_type_sort_order(value: unknown): number {
    return is_model_type(value) ? MODEL_TYPE_DEFINITIONS[value].sort_order : 99;
  }

  /**
   * 自定义模板路径只由模型类型计算，避免调用点散落文件名
   */
  public static resolve_template_filename(value: CustomModelType): string;
  public static resolve_template_filename(value: unknown): string | null;
  public static resolve_template_filename(value: unknown): string | null {
    return is_model_type(value) ? MODEL_TYPE_DEFINITIONS[value].template_filename : null;
  }

  /**
   * API 格式是否允许显示思考配置，具体请求仍以模型配置与模型能力为准。
   */
  public static api_format_supports_thinking_configuration(api_format: ModelApiFormat): boolean {
    return api_format !== "SakuraLLM";
  }

  /** 模板存在性是自定义类型的唯一判据，避免另维护一份并行枚举。 */
  public static is_custom_type(value: unknown): value is CustomModelType {
    return is_model_type(value) && MODEL_TYPE_DEFINITIONS[value].template_filename !== null;
  }

  /**
   * 服务层用这个顺序补齐每类自定义模型模板，避免枚举散落
   */
  public static custom_types(): CustomModelType[] {
    return MODEL_TYPES.filter(Model.is_custom_type);
  }

  private static normalize_request_config(value: unknown): ModelRequestConfig {
    const record = read_json_model_record(value);
    return {
      ...DEFAULT_REQUEST_CONFIG,
      ...record,
      extra_headers: { ...read_json_record(record["extra_headers"]) },
      extra_body: { ...read_json_record(record["extra_body"]) },
      extra_headers_custom_enable: Boolean(record["extra_headers_custom_enable"]),
      extra_body_custom_enable: Boolean(record["extra_body_custom_enable"]),
    };
  }

  private static normalize_threshold_config(value: unknown): ModelThresholdConfig {
    const record = read_json_model_record(value);
    return {
      input_token_limit: read_json_model_number(
        record["input_token_limit"],
        DEFAULT_THRESHOLD_CONFIG.input_token_limit,
      ),
      output_token_limit: read_json_model_number(
        record["output_token_limit"],
        DEFAULT_THRESHOLD_CONFIG.output_token_limit,
      ),
      rpm_limit: read_json_model_number(record["rpm_limit"], DEFAULT_THRESHOLD_CONFIG.rpm_limit),
      concurrency_limit: read_json_model_number(
        record["concurrency_limit"],
        DEFAULT_THRESHOLD_CONFIG.concurrency_limit,
      ),
    };
  }

  private static normalize_thinking_config(value: unknown): ModelThinkingConfig {
    const record = read_json_model_record(value);
    return {
      level: Model.normalize_thinking_level(record["level"] ?? DEFAULT_THINKING_CONFIG.level),
    };
  }

  private static normalize_generation_config(value: unknown): ModelGenerationConfig {
    const record = read_json_model_record(value);
    return {
      temperature: read_json_model_number(
        record["temperature"],
        DEFAULT_GENERATION_CONFIG.temperature,
      ),
      temperature_custom_enable: Boolean(record["temperature_custom_enable"]),
      top_p: read_json_model_number(record["top_p"], DEFAULT_GENERATION_CONFIG.top_p),
      top_p_custom_enable: Boolean(record["top_p_custom_enable"]),
    };
  }
}

export function is_model_type(value: unknown): value is ModelType {
  return MODEL_TYPE_SET.has(value as ModelType);
}

/** 配置、API 与执行解析共用同一模型用途形状，未知键不会进入运行时。 */
export function normalize_model_selection(value: unknown): ModelSelection {
  const record = read_json_record(value);
  return {
    translation: read_model_selection_id(record["translation"]),
    analysis: read_model_selection_id(record["analysis"]),
    agent: read_model_selection_id(record["agent"]),
  };
}

export function is_model_api_format(value: unknown): value is ModelApiFormat {
  return MODEL_API_FORMAT_SET.has(value as ModelApiFormat);
}

export function is_model_thinking_level(value: unknown): value is ModelThinkingLevel {
  return MODEL_THINKING_LEVEL_SET.has(value as ModelThinkingLevel);
}

function read_json_model_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

function read_json_model_number(value: unknown, fallback: number): number {
  const number_value = Number(value ?? fallback);
  return Number.isFinite(number_value) ? number_value : fallback;
}

function read_model_selection_id(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
