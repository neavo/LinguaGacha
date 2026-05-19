export const TASK_TYPES = ["translation", "analysis"] as const; // 任务类型权威；重翻由 translation scope 表达
export const TASK_RUN_STATUSES = [
  "idle",
  "requested",
  "running",
  "stopping",
  "done",
  "error",
] as const; // Engine 运行态状态机唯一值域
export const TASK_START_MODES = ["new", "continue", "reset"] as const; // 后台任务启动模式，公开命令进入核心前统一小写

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
export type TaskStartMode = (typeof TASK_START_MODES)[number];

export type TranslationScope =
  | { kind: "all" } // all 表示普通翻译读取当前工程可运行全集
  | { kind: "items"; item_ids: number[] }; // items 表示重翻等窄域翻译，只能携带不可变 id 列表

const TASK_TYPE_SET = new Set<string>(TASK_TYPES); // Set 只服务边界窄化，避免调用点重复散落 includes 判断
const TASK_RUN_STATUS_SET = new Set<string>(TASK_RUN_STATUSES);
const TASK_START_MODE_SET = new Set<string>(TASK_START_MODES);

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

/** normalize_task_type 只用于读取侧兜底，不承担命令校验职责 */
export function normalize_task_type(value: unknown, fallback: TaskType = "translation"): TaskType {
  return is_task_type(value) ? value : fallback;
}
