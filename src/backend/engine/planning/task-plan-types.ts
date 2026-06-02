import type { MutableJsonRecord } from "../run/task-run-types";

/**
 * 任务 item 快照仍是数据库 JSON 行的可变副本，规划器只读取字段，提交阶段才允许改状态。
 */
export type TaskItemRecord = MutableJsonRecord;

/**
 * 翻译 context 是 pipeline 的最小工作单元，包含 chunk、preceding 与重试元信息。
 */
export interface TranslationContext {
  work_unit_id: string;
  items: TaskItemRecord[];
  precedings: TaskItemRecord[];
  token_threshold: number;
  split_count: number;
  retry_count: number;
  is_initial: boolean;
}

/**
 * 翻译提交项只携带可批量写库的数据和 token 累计值。
 */
export interface TranslationCommitEntry {
  items: TaskItemRecord[];
  input_tokens: number;
  output_tokens: number;
}

/**
 * 翻译拆分重试会同时产生新 context 和强制失败条目，两者必须分开提交。
 */
export interface TranslationRetryPlan {
  retry_contexts: TranslationContext[];
  forced_error_items: TaskItemRecord[];
}

/**
 * 分析 item 上下文只传已渲染的分析源文本，防止 work unit 误写非分析字段。
 */
export interface AnalysisItemContext {
  item_id: number;
  file_path: string;
  src_text: string;
  previous_status: string | null;
}

/**
 * 分析 context 按文件路径聚合，日志和候选 first_seen_index 都依赖稳定顺序。
 */
export interface AnalysisContext {
  work_unit_id: string;
  file_path: string;
  items: AnalysisItemContext[];
  retry_count: number;
}

/**
 * 分析提交项把 checkpoint、候选和进度 delta 分开，避免提交时再次推导。
 */
export interface AnalysisCommitEntry {
  success_checkpoints: MutableJsonRecord[];
  error_checkpoints: MutableJsonRecord[];
  glossary_entries: MutableJsonRecord[];
  input_tokens: number;
  output_tokens: number;
  processed_delta: number;
  error_delta: number;
}
