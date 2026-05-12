// 任务类型；公开值用小写业务名。
export const TASK_TYPES = ["translation", "analysis", "retranslate"] as const;

// 翻译/分析模式（用户意图）。
export const TASK_MODES = ["full", "selected", "resume"] as const;

// 任务状态；公开快照只暴露跨层稳定状态。
export const TASK_STATUSES = ["IDLE", "RUNNING", "DONE", "ERROR", "STOPPING"] as const;

// 翻译 - 任务生命周期事件（发起/运行/结束）。
export const TRANSLATION_TASK_ACTIVE_STATUSES = [
  "REQUEST",
  "RUN",
  "TRANSLATING",
  "STOPPING",
] as const;

// 分析 - 任务生命周期事件（发起/运行/结束）。
export const ANALYSIS_TASK_ACTIVE_STATUSES = ["REQUEST", "RUN", "ANALYZING", "STOPPING"] as const;

// 空闲状态集合用于任务启动互斥和页面按钮可用性判断。
export const TASK_IDLE_STATUSES = ["DONE", "ERROR", "IDLE"] as const;

// 进度状态是 item 统计口径，不等同于任务生命周期状态。
export const TASK_PROGRESS_STATUSES = ["NONE", "PROCESSED", "ERROR"] as const;

// 这些 item 状态不会进入翻译或分析任务进度统计。
export const TASK_SKIPPED_ITEM_STATUSES = [
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskMode = (typeof TASK_MODES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskIdleStatus = (typeof TASK_IDLE_STATUSES)[number];
export type TaskProgressStatus = (typeof TASK_PROGRESS_STATUSES)[number];

const TASK_TYPE_SET = new Set<TaskType>(TASK_TYPES);
const TASK_MODE_SET = new Set<TaskMode>(TASK_MODES);
const TASK_STATUS_SET = new Set<TaskStatus>(TASK_STATUSES);
const TASK_IDLE_STATUS_SET = new Set<string>(TASK_IDLE_STATUSES);
const TASK_PROGRESS_STATUS_SET = new Set<TaskProgressStatus>(TASK_PROGRESS_STATUSES);
const TASK_SKIPPED_ITEM_STATUS_SET = new Set<string>(TASK_SKIPPED_ITEM_STATUSES);
const TRANSLATION_TASK_ACTIVE_STATUS_SET = new Set<string>(TRANSLATION_TASK_ACTIVE_STATUSES);
const ANALYSIS_TASK_ACTIVE_STATUS_SET = new Set<string>(ANALYSIS_TASK_ACTIVE_STATUSES);

// API 入参和页面任务类型先在基础层收窄，再交给服务层分发。
export function is_task_type(value: unknown): value is TaskType {
  return TASK_TYPE_SET.has(value as TaskType);
}

// 任务命令模式由 API 共享，服务层可继续按具体命令收窄。
export function is_task_mode(value: unknown): value is TaskMode {
  return TASK_MODE_SET.has(value as TaskMode);
}

// 公开任务状态用于 ProjectStore 快照，不能混入引擎内部状态。
export function is_task_status(value: unknown): value is TaskStatus {
  return TASK_STATUS_SET.has(value as TaskStatus);
}

// 空闲性判断接受公开空闲状态，供互斥检查复用。
export function is_task_idle_status(value: unknown): value is TaskIdleStatus {
  return TASK_IDLE_STATUS_SET.has(String(value));
}

// 进度统计只接受 item 级别三态，避免生命周期状态污染统计。
export function is_task_progress_status(value: unknown): value is TaskProgressStatus {
  return TASK_PROGRESS_STATUS_SET.has(value as TaskProgressStatus);
}

// 被规则跳过的 item 不计入待处理量，这里集中维护统计豁免口径。
export function is_task_skipped_item_status(value: unknown): boolean {
  return TASK_SKIPPED_ITEM_STATUS_SET.has(String(value));
}

// 翻译活跃态统一供快照折叠使用。
export function is_active_translation_task_status(value: unknown): boolean {
  return TRANSLATION_TASK_ACTIVE_STATUS_SET.has(String(value));
}

// 分析活跃态统一供快照折叠使用。
export function is_active_analysis_task_status(value: unknown): boolean {
  return ANALYSIS_TASK_ACTIVE_STATUS_SET.has(String(value));
}

// 未知任务类型按调用方给定回退值处理，避免异常 payload 阻断任务恢复。
export function normalize_task_type(value: unknown, fallback: TaskType = "translation"): TaskType {
  return is_task_type(value) ? value : fallback;
}
