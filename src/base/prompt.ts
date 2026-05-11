// 提示词只暴露翻译和分析两类任务，重翻复用翻译任务语义。
export const PROMPT_TASK_TYPES = ["translation", "analysis"] as const;

export type PromptTaskType = (typeof PROMPT_TASK_TYPES)[number];

export type PromptDatabaseType = "translation_prompt" | "analysis_prompt";

// PROMPT_TASK_MODEL 统一维护 prompt 任务到 rules 表物理槽位和 meta key 的映射。
export const PROMPT_TASK_MODEL = {
  translation: {
    database_type: "translation_prompt",
    enabled_meta_key: "translation_prompt_enable",
    revision_meta_key: "quality_prompt_revision.translation",
  },
  analysis: {
    database_type: "analysis_prompt",
    enabled_meta_key: "analysis_prompt_enable",
    revision_meta_key: "quality_prompt_revision.analysis",
  },
} as const satisfies Record<
  PromptTaskType,
  {
    database_type: PromptDatabaseType;
    enabled_meta_key: string;
    revision_meta_key: string;
  }
>;

const PROMPT_TASK_TYPE_SET = new Set<PromptTaskType>(PROMPT_TASK_TYPES);

// prompt 任务类型是公开 API 入参，写库前必须先收窄。
export function is_prompt_task_type(value: unknown): value is PromptTaskType {
  return PROMPT_TASK_TYPE_SET.has(value as PromptTaskType);
}

// 未知 prompt 任务会写入错误物理槽位，因此在边界直接失败。
export function normalize_prompt_task_type(value: unknown): PromptTaskType {
  if (is_prompt_task_type(value)) {
    return value;
  }
  throw new Error(`未知提示词任务类型：${String(value)}`);
}

// rules 表物理类型只从公开任务类型派生，调用点不直接拼接。
export function resolve_prompt_database_type(task_type: PromptTaskType): PromptDatabaseType {
  return PROMPT_TASK_MODEL[task_type].database_type;
}

// 启用开关 meta key 与任务类型绑定，避免迁移和 patch 使用不同命名。
export function build_prompt_enabled_meta_key(task_type: PromptTaskType): string {
  return PROMPT_TASK_MODEL[task_type].enabled_meta_key;
}

// revision key 是 ProjectStore 增量同步的契约字段，必须集中生成。
export function build_prompt_revision_key(task_type: PromptTaskType): string {
  return PROMPT_TASK_MODEL[task_type].revision_meta_key;
}
