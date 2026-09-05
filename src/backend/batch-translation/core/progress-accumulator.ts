import type { JsonValue } from "../../../domain/json";
import type { MutableJsonRecord } from "../../../domain/json";
import { normalize_batch_translation_progress } from "../../../domain/batch-translation";
import type { BatchTranslationProgress } from "../../../domain/batch-translation";

// 进度字段默认值集中在这里，避免 runner 新增字段时漏写归零逻辑
const EMPTY_PROGRESS: BatchTranslationProgress = {
  start_time: 0,
  time: 0,
  total_line: 0,
  line: 0,
  processed_line: 0,
  error_line: 0,
  total_tokens: 0,
  total_input_tokens: 0,
  total_reasoning_tokens: 0,
  total_output_tokens: 0,
};

/**
 * 任务进度快照工具，复刻历史 `BatchTranslationProgress` 的数值口径
 */
export class TranslationProgressAccumulator {
  /**
   * 创建新任务进度，start_time 使用秒级浮点数兼容旧前端展示
   */
  public static empty(total_line = 0, start_time = Date.now() / 1000): BatchTranslationProgress {
    return { ...EMPTY_PROGRESS, total_line, start_time };
  }

  /**
   * 从数据库 meta 或 executor payload 恢复进度，坏值统一归零
   */
  public static from_record(value: JsonValue | undefined): BatchTranslationProgress {
    return normalize_batch_translation_progress(value);
  }

  /**
   * 更新耗时字段时只依赖 start_time，避免多个 runner 各自累计误差
   */
  public static with_elapsed(snapshot: BatchTranslationProgress): BatchTranslationProgress {
    if (snapshot.start_time <= 0) {
      return { ...snapshot, time: 0 };
    }
    return {
      ...snapshot,
      time: Math.max(0, Date.now() / 1000 - snapshot.start_time),
    };
  }

  /**
   * 累计三段 token 并同步 total_tokens，保持分项字段是唯一来源
   */
  public static add_tokens(
    snapshot: BatchTranslationProgress,
    input_tokens: number,
    reasoning_tokens: number,
    output_tokens: number,
  ): BatchTranslationProgress {
    const total_input_tokens = snapshot.total_input_tokens + Math.trunc(input_tokens);
    const total_reasoning_tokens = snapshot.total_reasoning_tokens + Math.trunc(reasoning_tokens);
    const total_output_tokens = snapshot.total_output_tokens + Math.trunc(output_tokens);
    return {
      ...snapshot,
      total_input_tokens,
      total_reasoning_tokens,
      total_output_tokens,
      total_tokens: total_input_tokens + total_reasoning_tokens + total_output_tokens,
    };
  }

  /**
   * 更新行数统计，并默认让 line 等于 processed + error
   */
  public static with_counts(
    snapshot: BatchTranslationProgress,
    counts: Partial<Pick<BatchTranslationProgress, "total_line" | "processed_line" | "error_line">>,
  ): BatchTranslationProgress {
    const processed_line = counts.processed_line ?? snapshot.processed_line;
    const error_line = counts.error_line ?? snapshot.error_line;
    return {
      ...snapshot,
      total_line: counts.total_line ?? snapshot.total_line,
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 转成可写入 database meta 的普通 JSON 对象
   */
  public static to_record(snapshot: BatchTranslationProgress): MutableJsonRecord {
    return { ...snapshot };
  }
}
