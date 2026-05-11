// 模型类型是配置文件、模型页分组和服务端模板选择共享的稳定值域。
export const MODEL_TYPES = [
  "PRESET",
  "CUSTOM_GOOGLE",
  "CUSTOM_OPENAI",
  "CUSTOM_ANTHROPIC",
] as const;

// API 格式同时影响连通性测试、LLM adapter 和请求 payload 兼容策略。
export const MODEL_API_FORMATS = ["OpenAI", "SakuraLLM", "Google", "Anthropic"] as const;

// thinking 档位只在支持推理的模型上生效，但快照值域保持统一。
export const MODEL_THINKING_LEVELS = ["OFF", "LOW", "MEDIUM", "HIGH"] as const;

export type ModelType = (typeof MODEL_TYPES)[number];
export type ModelApiFormat = (typeof MODEL_API_FORMATS)[number];
export type ModelThinkingLevel = (typeof MODEL_THINKING_LEVELS)[number];

// 排序值决定配置落盘与模型页展示顺序，新增类型时必须显式补齐。
export const MODEL_TYPE_SORT_ORDER = {
  PRESET: 0,
  CUSTOM_GOOGLE: 1,
  CUSTOM_OPENAI: 2,
  CUSTOM_ANTHROPIC: 3,
} as const satisfies Record<ModelType, number>;

// 自定义模型模板文件名由模型类型唯一决定，服务层不再手写分发表。
export const MODEL_TEMPLATE_FILENAME_BY_TYPE = {
  CUSTOM_GOOGLE: "preset_model_custom_google.json",
  CUSTOM_OPENAI: "preset_model_custom_openai.json",
  CUSTOM_ANTHROPIC: "preset_model_custom_anthropic.json",
} as const satisfies Partial<Record<ModelType, string>>;

const MODEL_TYPE_SET = new Set<ModelType>(MODEL_TYPES);
const MODEL_API_FORMAT_SET = new Set<ModelApiFormat>(MODEL_API_FORMATS);
const MODEL_THINKING_LEVEL_SET = new Set<ModelThinkingLevel>(MODEL_THINKING_LEVELS);

// 模型配置从磁盘和页面表单进入时先收窄到稳定类型。
export function is_model_type(value: unknown): value is ModelType {
  return MODEL_TYPE_SET.has(value as ModelType);
}

// PRESET 不拥有自定义模板文件，服务层据此跳过模板写入。
export function is_custom_model_type(value: unknown): value is Exclude<ModelType, "PRESET"> {
  return value === "CUSTOM_GOOGLE" || value === "CUSTOM_OPENAI" || value === "CUSTOM_ANTHROPIC";
}

// 未知模型类型按历史默认预设处理，避免旧配置阻断启动。
export function normalize_model_type(value: unknown): ModelType {
  return is_model_type(value) ? value : "PRESET";
}

// API 格式来自用户配置，必须先判定再选择 adapter 分支。
export function is_model_api_format(value: unknown): value is ModelApiFormat {
  return MODEL_API_FORMAT_SET.has(value as ModelApiFormat);
}

// 未知 API 格式回退 OpenAI 兼容协议，这是现有自定义模型的默认路径。
export function normalize_model_api_format(value: unknown): ModelApiFormat {
  return is_model_api_format(value) ? value : "OpenAI";
}

// thinking 档位只接受公开值域，防止页面状态保存出临时枚举。
export function is_model_thinking_level(value: unknown): value is ModelThinkingLevel {
  return MODEL_THINKING_LEVEL_SET.has(value as ModelThinkingLevel);
}

// 旧模型配置缺失 thinking 时按关闭推理处理。
export function normalize_model_thinking_level(value: unknown): ModelThinkingLevel {
  return is_model_thinking_level(value) ? value : "OFF";
}

// 未知类型排在最后，模型页排序不因脏数据抛错。
export function resolve_model_type_sort_order(value: unknown): number {
  return is_model_type(value) ? MODEL_TYPE_SORT_ORDER[value] : 99;
}

// 自定义模板路径只由模型类型派生，避免调用点散落文件名。
export function resolve_model_template_filename(value: unknown): string | null {
  return is_custom_model_type(value) ? MODEL_TEMPLATE_FILENAME_BY_TYPE[value] : null;
}

// 默认推理能力用于初始化设置，具体请求仍以模型配置为准。
export function model_api_format_supports_reasoning_by_default(
  api_format: ModelApiFormat,
): boolean {
  return api_format === "Google" || api_format === "Anthropic";
}
