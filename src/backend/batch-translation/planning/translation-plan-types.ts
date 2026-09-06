import type { TextTaskItemRecord } from "../../../shared/text/text-types";

/**
 * 翻译 context 是 pipeline 的最小工作单元，包含 chunk、preceding 与重试元信息。
 */
export interface TranslationContext {
  work_unit_id: string;
  items: TextTaskItemRecord[];
  precedings: TextTaskItemRecord[];
  token_threshold: number;
  split_count: number;
  retry_count: number;
  is_initial: boolean;
}

/**
 * 翻译提交项只携带可批量写库的数据和 token 累计值。
 */
export interface TranslationCommitEntry {
  items: TextTaskItemRecord[];
  input_tokens: number;
  reasoning_tokens: number; // 请求思考 token，不计入输出 token
  output_tokens: number; // 已扣除思考 token 的模型输出
}

/**
 * 翻译拆分重试会同时产生新 context 和强制失败条目，两者必须分开提交。
 */
export interface TranslationRetryPlan {
  retry_contexts: TranslationContext[];
  forced_error_items: TextTaskItemRecord[];
}
