import type { JsonRecord, JsonValue } from "../shared/utils/json-tool";

// 模型类型是设置文件、模型页分组和服务端模板选择共享的稳定值域
/**
 * 集中维护当前模块的稳定常量。
 */
export const MODEL_TYPES = [
  "PRESET",
  "CUSTOM_GOOGLE",
  "CUSTOM_OPENAI",
  "CUSTOM_ANTHROPIC",
] as const;

/**
 * 集中维护当前模块的稳定常量。
 */
export const MODEL_API_FORMATS = ["OpenAI", "SakuraLLM", "Google", "Anthropic"] as const; // API 格式同时影响连通性测试、LLM adapter 和请求 payload 兼容策略

/**
 * 集中维护当前模块的稳定常量。
 */
export const MODEL_THINKING_LEVELS = ["OFF", "LOW", "MEDIUM", "HIGH"] as const; // thinking 档位只在支持推理的模型上生效，但快照值域保持统一

export type ModelType = (typeof MODEL_TYPES)[number];
export type ModelApiFormat = (typeof MODEL_API_FORMATS)[number];
export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];
type ModelJsonRecord = Record<string, JsonValue>;

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
  presence_penalty: number; // Presence penalty
  presence_penalty_custom_enable: boolean; // 是否启用自定义 presence penalty
  frequency_penalty: number; // Frequency penalty
  frequency_penalty_custom_enable: boolean; // 是否启用自定义 frequency penalty
};

const MODEL_TYPE_SET = new Set<ModelType>(MODEL_TYPES);
const MODEL_API_FORMAT_SET = new Set<ModelApiFormat>(MODEL_API_FORMATS);
const MODEL_THINKING_LEVEL_SET = new Set<ModelThinkingLevel>(MODEL_THINKING_LEVELS);

// 排序值决定设置落盘与模型页展示顺序，新增类型时必须显式补齐
const MODEL_TYPE_SORT_ORDER = {
  PRESET: 0,
  CUSTOM_GOOGLE: 1,
  CUSTOM_OPENAI: 2,
  CUSTOM_ANTHROPIC: 3,
} as const satisfies Record<ModelType, number>;

// 自定义模型模板文件名由模型类型唯一决定，服务层不再手写分发表
const MODEL_TEMPLATE_FILENAME_BY_TYPE = {
  CUSTOM_GOOGLE: "preset_model_custom_google.json",
  CUSTOM_OPENAI: "preset_model_custom_openai.json",
  CUSTOM_ANTHROPIC: "preset_model_custom_anthropic.json",
} as const satisfies Partial<Record<ModelType, string>>;

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
  presence_penalty: 0,
  presence_penalty_custom_enable: false,
  frequency_penalty: 0,
  frequency_penalty_custom_enable: false,
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
  public readonly request: ModelRequestConfig; // 请求层配置快照
  public readonly threshold: ModelThresholdConfig; // 阈值配置快照
  public readonly thinking: ModelThinkingConfig; // 思考挡位配置快照
  public readonly generation: ModelGenerationConfig; // 生成参数配置快照

  /**
   * 初始化当前实例的内部状态。
   */
  private constructor(fields: {
    id: string;
    type: ModelType;
    name: string;
    api_format: ModelApiFormat;
    api_url: string;
    api_key: string;
    model_id: string;
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
    return new Model({
      id: String(record["id"] ?? fallback_id),
      type: Model.normalize_type(record["type"]),
      name: String(record["name"] ?? ""),
      api_format: Model.normalize_api_format(record["api_format"]),
      api_url: String(record["api_url"] ?? ""),
      api_key: String(record["api_key"] ?? "no_key_required"),
      model_id: String(record["model_id"] ?? ""),
      request: Model.normalize_request_config(record["request"]),
      threshold: Model.normalize_threshold_config(record["threshold"]),
      thinking: Model.normalize_thinking_config(record["thinking"]),
      generation: Model.normalize_generation_config(record["generation"]),
    });
  }

  /**
   * 输出模型设置 JSON，跨进程和任务 worker 都只消费普通对象
   */
  public to_json(): ModelJsonRecord {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      api_format: this.api_format,
      api_url: this.api_url,
      api_key: this.api_key,
      model_id: this.model_id,
      request: this.request as unknown as JsonValue,
      threshold: this.threshold as unknown as JsonValue,
      thinking: this.thinking as unknown as JsonValue,
      generation: this.generation as unknown as JsonValue,
    };
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
    return is_model_type(value) ? MODEL_TYPE_SORT_ORDER[value] : 99;
  }

  /**
   * 自定义模板路径只由模型类型计算，避免调用点散落文件名
   */
  public static resolve_template_filename(value: unknown): string | null {
    return Model.is_custom_type(value) ? MODEL_TEMPLATE_FILENAME_BY_TYPE[value] : null;
  }

  /**
   * 默认推理能力用于初始化设置，具体请求仍以模型配置为准
   */
  public static api_format_supports_reasoning_by_default(api_format: ModelApiFormat): boolean {
    return api_format === "Google" || api_format === "Anthropic";
  }

  /**
   * 判断当前值是否满足业务条件。
   */
  public static is_custom_type(value: unknown): value is Exclude<ModelType, "PRESET"> {
    return value === "CUSTOM_GOOGLE" || value === "CUSTOM_OPENAI" || value === "CUSTOM_ANTHROPIC";
  }

  /**
   * 服务层用这个顺序补齐每类自定义模型模板，避免枚举散落
   */
  public static custom_types(): Array<Exclude<ModelType, "PRESET">> {
    return ["CUSTOM_GOOGLE", "CUSTOM_OPENAI", "CUSTOM_ANTHROPIC"];
  }

  /**
   * 归一化输入，保证下游消费稳定形状。
   */
  private static normalize_request_config(value: unknown): ModelRequestConfig {
    const record = read_json_model_record(value);
    return {
      ...DEFAULT_REQUEST_CONFIG,
      ...record,
      extra_headers: read_json_record(record["extra_headers"]),
      extra_body: read_json_record(record["extra_body"]),
      extra_headers_custom_enable: Boolean(record["extra_headers_custom_enable"]),
      extra_body_custom_enable: Boolean(record["extra_body_custom_enable"]),
    };
  }

  /**
   * 归一化输入，保证下游消费稳定形状。
   */
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

  /**
   * 归一化输入，保证下游消费稳定形状。
   */
  private static normalize_thinking_config(value: unknown): ModelThinkingConfig {
    const record = read_json_model_record(value);
    return {
      level: Model.normalize_thinking_level(record["level"] ?? DEFAULT_THINKING_CONFIG.level),
    };
  }

  /**
   * 归一化输入，保证下游消费稳定形状。
   */
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
      presence_penalty: read_json_model_number(
        record["presence_penalty"],
        DEFAULT_GENERATION_CONFIG.presence_penalty,
      ),
      presence_penalty_custom_enable: Boolean(record["presence_penalty_custom_enable"]),
      frequency_penalty: read_json_model_number(
        record["frequency_penalty"],
        DEFAULT_GENERATION_CONFIG.frequency_penalty,
      ),
      frequency_penalty_custom_enable: Boolean(record["frequency_penalty_custom_enable"]),
    };
  }
}

/**
 * 判断当前值是否满足业务条件。
 */
export function is_model_type(value: unknown): value is ModelType {
  return MODEL_TYPE_SET.has(value as ModelType);
}

/**
 * 判断当前值是否满足业务条件。
 */
export function is_model_api_format(value: unknown): value is ModelApiFormat {
  return MODEL_API_FORMAT_SET.has(value as ModelApiFormat);
}

/**
 * 判断当前值是否满足业务条件。
 */
export function is_model_thinking_level(value: unknown): value is ModelThinkingLevel {
  return MODEL_THINKING_LEVEL_SET.has(value as ModelThinkingLevel);
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_json_model_record(value: unknown): ModelJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as ModelJsonRecord) }
    : {};
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_json_record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

/**
 * 读取当前场景需要的稳定数据。
 */
function read_json_model_number(value: unknown, fallback: number): number {
  const number_value = Number(value ?? fallback);
  return Number.isFinite(number_value) ? number_value : fallback;
}
