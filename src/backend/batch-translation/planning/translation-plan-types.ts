import type { TextTaskItemRecord } from "../../../shared/text/text-types";

/** 指标对应本轮固定源文；只用于切块，不进入计费统计或项目存储。 */
export type TranslationTokenMetric = Readonly<{
  token_count: number;
  line_count: number;
}>;

/** Runner 局部持有直到任务结束；重试读取同一指标，不受跨任务 LRU 淘汰影响。 */
export type TranslationPlan = Readonly<{
  contexts: TranslationContext[];
  metrics: ReadonlyMap<number, TranslationTokenMetric>;
}>;

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
 * 翻译拆分重试会同时产生新 context 和强制失败条目，两者必须分开提交。
 */
export interface TranslationRetryPlan {
  retry_contexts: TranslationContext[];
  forced_error_items: TextTaskItemRecord[];
}
