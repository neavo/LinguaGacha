import { is_model_thinking_level, type ModelThinkingLevel } from "./model";

/** 从本次执行配置投影的非敏感摘要，跨续跑保留各自实际采用的值。 */
export type BatchTranslationConfig = Readonly<{
  model_name: string;
  model_id: string;
  thinking_level: ModelThinkingLevel | null;
  source_language: string;
  target_language: string;
}>;

/** 运行配置在尚未解析、工程重开或新运行预约时可以缺失。 */
export function normalize_batch_translation_config(
  value: unknown,
): BatchTranslationConfig | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { model_name, model_id, thinking_level, source_language, target_language } = record;
  if (
    typeof model_name !== "string" ||
    typeof model_id !== "string" ||
    typeof source_language !== "string" ||
    typeof target_language !== "string" ||
    (thinking_level !== null && !is_model_thinking_level(thinking_level))
  )
    return undefined;
  return { model_name, model_id, thinking_level, source_language, target_language };
}

export const BATCH_TRANSLATION_RUN_STATUSES = [
  "idle",
  "requested",
  "running",
  "stopping",
  "stopped",
  "done",
  "error",
] as const; // Engine 运行态状态机唯一值域

export const BATCH_TRANSLATION_START_MODES = ["new", "continue", "reset"] as const; // 后台任务启动模式，公开命令进入核心前统一小写

export const BATCH_TRANSLATION_ACTIVE_STATUSES = ["requested", "running", "stopping"] as const; // 翻译活跃态供 renderer 折叠快照使用

export const TASK_PROGRESS_STATUSES = ["NONE", "PROCESSED", "ERROR"] as const; // 进度状态是 item 统计口径，不等同于任务生命周期状态

// 这些 item 状态不会进入翻译进度统计
export const TASK_SKIPPED_ITEM_STATUSES = [
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
] as const;

export const BATCH_TRANSLATION_STOP_SOURCES = ["user", "parent", "shutdown"] as const;
export type BatchTranslationStopSource = (typeof BATCH_TRANSLATION_STOP_SOURCES)[number];

export type BatchTranslationRunStatus = (typeof BATCH_TRANSLATION_RUN_STATUSES)[number];
export type BatchTranslationStartMode = (typeof BATCH_TRANSLATION_START_MODES)[number];
export type BatchTranslationProgressStatus = (typeof TASK_PROGRESS_STATUSES)[number];

export type BatchTranslationProgress = {
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

export type BatchTranslationScope =
  | { kind: "all" } // all 表示普通翻译读取当前工程可运行全集
  | { kind: "items"; item_ids: number[] }; // items 表示重翻等窄域翻译，只能携带不可变 id 列表

const TASK_START_MODE_SET = new Set<string>(BATCH_TRANSLATION_START_MODES);
const TASK_PROGRESS_STATUS_SET = new Set<string>(TASK_PROGRESS_STATUSES);
const TASK_SKIPPED_ITEM_STATUS_SET = new Set<string>(TASK_SKIPPED_ITEM_STATUSES);
const BATCH_TRANSLATION_ACTIVE_STATUS_SET = new Set<string>(BATCH_TRANSLATION_ACTIVE_STATUSES);

/** 判断启动模式，公开请求进入核心前必须先被窄化 */
export function is_batch_translation_start_mode(
  value: unknown,
): value is BatchTranslationStartMode {
  return TASK_START_MODE_SET.has(String(value));
}

// 进度统计只接受 item 级别三态，避免生命周期状态污染统计
export function is_task_progress_status(value: unknown): value is BatchTranslationProgressStatus {
  return TASK_PROGRESS_STATUS_SET.has(value as BatchTranslationProgressStatus);
}

// 被规则跳过的 item 不计入待处理量，这里集中维护统计豁免口径
export function is_task_skipped_item_status(value: unknown): boolean {
  return TASK_SKIPPED_ITEM_STATUS_SET.has(String(value));
}

// 翻译活跃态统一供快照折叠使用
export function is_active_batch_translation_status(value: unknown): boolean {
  return BATCH_TRANSLATION_ACTIVE_STATUS_SET.has(String(value));
}

/** 任务进度只保留固定数值字段；坏值、负数和非有限数统一归零。 */
export function normalize_batch_translation_progress(value: unknown): BatchTranslationProgress {
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

/** 持久化进度读取时将缺失、负数与非有限值归零。 */
function read_non_negative_number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** 条目与 token 计数沿用非负整数口径。 */
function read_non_negative_integer(value: unknown): number {
  return Math.trunc(read_non_negative_number(value));
}

/** 保留合法条目 ID 的首次出现顺序。 */
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
export function normalize_translation_scope(value: unknown): BatchTranslationScope {
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
export function clone_translation_scope(scope: BatchTranslationScope): BatchTranslationScope {
  return scope.kind === "items"
    ? { kind: "items", item_ids: [...scope.item_ids] }
    : { kind: "all" };
}

export type BatchTranslationSnapshot = {
  config?: BatchTranslationConfig;
  revision: number;
  status: BatchTranslationRunStatus;
  stop_source?: BatchTranslationStopSource; // 本轮首次受理的取消来源，收尾失败也保留
  request_in_flight_count: number;
  progress: BatchTranslationProgress;
  scope: BatchTranslationScope;
};

export type BatchTranslationResult = Readonly<{
  status: "done" | "stopped" | "error";
  stop_source?: BatchTranslationStopSource;
  progress: Readonly<BatchTranslationProgress>;
}>;

export type BatchTranslationStartCommand = {
  mode: BatchTranslationStartMode;
  scope: BatchTranslationScope;
};

export type BatchTranslationSnapshotListener = (
  snapshot: Readonly<BatchTranslationSnapshot>,
) => void | Promise<void>;

/** 工作台和 Agent 按当前工程累计进度选择开始或继续。 */
export function resolve_batch_translation_start_mode(
  progress: BatchTranslationProgress,
): "new" | "continue" {
  return progress.total_line > 0 ||
    progress.line > 0 ||
    progress.processed_line > 0 ||
    progress.error_line > 0 ||
    progress.total_tokens > 0 ||
    progress.total_input_tokens > 0 ||
    progress.total_reasoning_tokens > 0 ||
    progress.total_output_tokens > 0
    ? "continue"
    : "new";
}
