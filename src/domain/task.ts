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

export const TRANSLATION_TASK_ACTIVE_STATUSES = ["requested", "running", "stopping"] as const; // 翻译活跃态供 renderer 折叠快照使用
export const ANALYSIS_TASK_ACTIVE_STATUSES = ["requested", "running", "stopping"] as const; // 分析活跃态供 renderer 折叠快照使用

export const TASK_PROGRESS_STATUSES = ["NONE", "PROCESSED", "ERROR"] as const; // 进度状态是 item 统计口径，不等同于任务生命周期状态

// 这些 item 状态不会进入翻译或分析任务进度统计
export const TASK_SKIPPED_ITEM_STATUSES = [
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];
export type TaskStartMode = (typeof TASK_START_MODES)[number];
export type TaskProgressStatus = (typeof TASK_PROGRESS_STATUSES)[number];

export type TaskProgressSnapshot = {
  start_time: number; // 秒级任务启动时间戳
  time: number; // 由 start_time 计算的累计耗时秒数
  total_line: number; // 任务启动时冻结的目标行数
  line: number; // 已成功与最终失败行数之和
  processed_line: number; // 已成功提交的行数
  error_line: number; // 最终失败的行数
  total_tokens: number; // 输入、思考与输出 token 总量
  total_input_tokens: number; // work unit 汇总的输入 token
  total_reasoning_tokens: number; // work unit 汇总的思考 token
  total_output_tokens: number; // work unit 汇总的输出 token
};

export type TranslationScope =
  | { kind: "all" } // all 表示普通翻译读取当前工程可运行全集
  | { kind: "items"; item_ids: number[] }; // items 表示重翻等窄域翻译，只能携带不可变 id 列表

const TASK_TYPE_SET = new Set<string>(TASK_TYPES); // Set 只服务边界窄化，避免调用点重复散落 includes 判断
const TASK_START_MODE_SET = new Set<string>(TASK_START_MODES);
const TASK_PROGRESS_STATUS_SET = new Set<string>(TASK_PROGRESS_STATUSES);
const TASK_SKIPPED_ITEM_STATUS_SET = new Set<string>(TASK_SKIPPED_ITEM_STATUSES);
const TRANSLATION_TASK_ACTIVE_STATUS_SET = new Set<string>(TRANSLATION_TASK_ACTIVE_STATUSES);
const ANALYSIS_TASK_ACTIVE_STATUS_SET = new Set<string>(ANALYSIS_TASK_ACTIVE_STATUSES);

/** 判断公开任务类型，明确拒绝 retranslate 成为第三种 TaskType */
export function is_task_type(value: unknown): value is TaskType {
  return TASK_TYPE_SET.has(String(value));
}

/** 判断启动模式，公开请求进入核心前必须先被窄化 */
export function is_task_start_mode(value: unknown): value is TaskStartMode {
  return TASK_START_MODE_SET.has(String(value));
}

// 进度统计只接受 item 级别三态，避免生命周期状态污染统计
export function is_task_progress_status(value: unknown): value is TaskProgressStatus {
  return TASK_PROGRESS_STATUS_SET.has(value as TaskProgressStatus);
}

// 被规则跳过的 item 不计入待处理量，这里集中维护统计豁免口径
export function is_task_skipped_item_status(value: unknown): boolean {
  return TASK_SKIPPED_ITEM_STATUS_SET.has(String(value));
}

// 翻译活跃态统一供快照折叠使用
export function is_active_translation_task_status(value: unknown): boolean {
  return TRANSLATION_TASK_ACTIVE_STATUS_SET.has(String(value));
}

// 分析活跃态统一供快照折叠使用
export function is_active_analysis_task_status(value: unknown): boolean {
  return ANALYSIS_TASK_ACTIVE_STATUS_SET.has(String(value));
}

/** 任务进度只保留固定数值字段；坏值、负数和非有限数统一归零。 */
export function normalize_task_progress_snapshot(value: unknown): TaskProgressSnapshot {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    start_time: read_non_negative_number(record["start_time"]),
    time: read_non_negative_number(record["time"]),
    total_line: read_non_negative_integer(record["total_line"]),
    line: read_non_negative_integer(record["line"]),
    processed_line: read_non_negative_integer(record["processed_line"]),
    error_line: read_non_negative_integer(record["error_line"]),
    total_tokens: read_non_negative_integer(record["total_tokens"]),
    total_input_tokens: read_non_negative_integer(record["total_input_tokens"]),
    total_reasoning_tokens: read_non_negative_integer(record["total_reasoning_tokens"]),
    total_output_tokens: read_non_negative_integer(record["total_output_tokens"]),
  };
}

function read_non_negative_number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function read_non_negative_integer(value: unknown): number {
  return Math.trunc(read_non_negative_number(value));
}

function normalize_translation_item_ids(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const item_ids: number[] = [];
  const seen_ids = new Set<number>();
  value.forEach((raw_item_id) => {
    const item_id = Number(raw_item_id);
    if (!Number.isInteger(item_id) || item_id <= 0 || seen_ids.has(item_id)) {
      return;
    }

    seen_ids.add(item_id);
    item_ids.push(item_id);
  });
  return item_ids;
}

/** translation scope 读取侧归一化；空 items 表示运行中重翻已经没有剩余行，命令边界仍负责拒绝空请求 */
export function normalize_translation_scope(value: unknown): TranslationScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "all" };
  }

  const scope = value as Record<string, unknown>;
  if (scope["kind"] !== "items") {
    return { kind: "all" };
  }

  const raw_item_ids = scope["item_ids"];
  const item_ids = normalize_translation_item_ids(raw_item_ids);
  if (item_ids.length > 0) {
    return { kind: "items", item_ids };
  }

  return Array.isArray(raw_item_ids) && raw_item_ids.length === 0
    ? { kind: "items", item_ids: [] }
    : { kind: "all" };
}

/** 克隆 translation scope，避免跨运行态共享 item_ids 数组引用 */
export function clone_translation_scope(scope: TranslationScope): TranslationScope {
  return scope.kind === "items"
    ? { kind: "items", item_ids: [...scope.item_ids] }
    : { kind: "all" };
}
