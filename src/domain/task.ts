/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_TYPES = ["translation", "analysis"] as const; // 任务类型权威；重翻由 translation scope 表达

/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_RUN_STATUSES = [
  "idle",
  "requested",
  "running",
  "stopping",
  "done",
  "error",
] as const; // Engine 运行态状态机唯一值域

/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_START_MODES = ["new", "continue", "reset"] as const; // 后台任务启动模式，公开命令进入核心前统一小写

/**
 * 集中维护当前模块的稳定常量。
 */
export const TRANSLATION_TASK_ACTIVE_STATUSES = ["requested", "running", "stopping"] as const; // 翻译活跃态供 renderer 折叠快照使用
/**
 * 集中维护当前模块的稳定常量。
 */
export const ANALYSIS_TASK_ACTIVE_STATUSES = ["requested", "running", "stopping"] as const; // 分析活跃态供 renderer 折叠快照使用

/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_IDLE_STATUSES = ["done", "error", "idle"] as const; // 空闲状态集合用于任务启动互斥和页面按钮可用性判断

/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_PROGRESS_STATUSES = ["NONE", "PROCESSED", "ERROR"] as const; // 进度状态是 item 统计口径，不等同于任务生命周期状态

// 这些 item 状态不会进入翻译或分析任务进度统计
/**
 * 集中维护当前模块的稳定常量。
 */
export const TASK_SKIPPED_ITEM_STATUSES = [
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
export type TaskStartMode = (typeof TASK_START_MODES)[number];
export type TaskIdleStatus = (typeof TASK_IDLE_STATUSES)[number];
export type TaskProgressStatus = (typeof TASK_PROGRESS_STATUSES)[number];

export type TranslationScope =
  | { kind: "all" } // all 表示普通翻译读取当前工程可运行全集
  | { kind: "items"; item_ids: number[] }; // items 表示重翻等窄域翻译，只能携带不可变 id 列表

const TASK_TYPE_SET = new Set<string>(TASK_TYPES); // Set 只服务边界窄化，避免调用点重复散落 includes 判断
const TASK_RUN_STATUS_SET = new Set<string>(TASK_RUN_STATUSES);
const TASK_START_MODE_SET = new Set<string>(TASK_START_MODES);
const TASK_IDLE_STATUS_SET = new Set<string>(TASK_IDLE_STATUSES);
const TASK_PROGRESS_STATUS_SET = new Set<string>(TASK_PROGRESS_STATUSES);
const TASK_SKIPPED_ITEM_STATUS_SET = new Set<string>(TASK_SKIPPED_ITEM_STATUSES);
const TRANSLATION_TASK_ACTIVE_STATUS_SET = new Set<string>(TRANSLATION_TASK_ACTIVE_STATUSES);
const ANALYSIS_TASK_ACTIVE_STATUS_SET = new Set<string>(ANALYSIS_TASK_ACTIVE_STATUSES);

/** 判断公开任务类型，明确拒绝 retranslate 成为第三种 TaskType */
export function is_task_type(value: unknown): value is TaskType {
  return TASK_TYPE_SET.has(String(value));
}

/** 判断 Engine 运行态状态值，所有层统一使用小写状态机 */
export function is_task_run_status(value: unknown): value is TaskRunStatus {
  return TASK_RUN_STATUS_SET.has(String(value));
}

/** 判断启动模式，公开请求进入核心前必须先被窄化 */
export function is_task_start_mode(value: unknown): value is TaskStartMode {
  return TASK_START_MODE_SET.has(String(value));
}

// 空闲性判断接受公开空闲状态，供互斥检查复用
/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_idle_status(value: unknown): value is TaskIdleStatus {
  return TASK_IDLE_STATUS_SET.has(String(value));
}

// 进度统计只接受 item 级别三态，避免生命周期状态污染统计
/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_progress_status(value: unknown): value is TaskProgressStatus {
  return TASK_PROGRESS_STATUS_SET.has(value as TaskProgressStatus);
}

// 被规则跳过的 item 不计入待处理量，这里集中维护统计豁免口径
/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_skipped_item_status(value: unknown): boolean {
  return TASK_SKIPPED_ITEM_STATUS_SET.has(String(value));
}

// 翻译活跃态统一供快照折叠使用
/**
 * 判断当前值是否满足业务条件。
 */
export function is_active_translation_task_status(value: unknown): boolean {
  return TRANSLATION_TASK_ACTIVE_STATUS_SET.has(String(value));
}

// 分析活跃态统一供快照折叠使用
/**
 * 判断当前值是否满足业务条件。
 */
export function is_active_analysis_task_status(value: unknown): boolean {
  return ANALYSIS_TASK_ACTIVE_STATUS_SET.has(String(value));
}

/** normalize_task_type 只用于读取侧兜底，不承担命令校验职责 */
export function normalize_task_type(value: unknown, fallback: TaskType = "translation"): TaskType {
  return is_task_type(value) ? value : fallback;
}
