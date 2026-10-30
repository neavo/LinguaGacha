import {
  normalize_batch_translation_progress,
  type BatchTranslationProgress,
} from "../../../domain/batch-translation";

/**
 * 任务进度快照工具，共享工程与本轮的时间、用量计算
 */
export class TranslationProgressAccumulator {
  /**
   * 共用领域默认值，启动时间使用秒。
   */
  public static empty(total_line = 0, start_time = Date.now() / 1000): BatchTranslationProgress {
    return { ...normalize_batch_translation_progress(undefined), total_line, start_time };
  }

  /**
   * 更新耗时字段时只依赖 start_time，避免多个 runner 各自累计误差
   */
  public static with_elapsed<T extends BatchTranslationProgress>(snapshot: T): T {
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
  public static add_tokens<T extends BatchTranslationProgress>(
    snapshot: T,
    input_tokens: number,
    reasoning_tokens: number,
    output_tokens: number,
  ): T {
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
}
