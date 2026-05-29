import crypto from "node:crypto";

export const TASK_PLANNER_TOKENIZER_ID = "o200k_base"; // 进程内 token metric cache 的 tokenizer 身份，变更 tokenizer 时 cache key 自动隔离。
export const TASK_TOKEN_METRIC_CACHE_CAPACITY = 32768; // 覆盖大型项目常见重复短句，同时限制进程内内存增长。

/**
 * 单条源文本的规划指标；这些指标只存在内存中，不写回 `.lg` 项目事实。
 */
export interface TaskTokenMetric {
  token_count: number;
  line_count: number;
}

/**
 * token 计数 worker 的最小输入；cache_key 由主线程生成，worker 不理解 item 或项目事实。
 */
export interface TaskTokenCountInput {
  cache_key: string;
  text: string;
}

/**
 * token 计数 worker 的最小输出；主线程负责把结果放回 cache 并用于 chunk 规划。
 */
export interface TaskTokenCountResult {
  cache_key: string;
  token_count: number;
}

/**
 * 统计非空行数，保持与旧 TaskEngine 切块 line_limit 同一口径。
 */
export function count_non_empty_source_lines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").length;
}

/**
 * 根据 tokenizer、文本长度和文本 hash 构造稳定 cache key，避免长文本作为 Map key 长期驻留。
 */
export function build_task_token_metric_cache_key(text: string): string {
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  return `${TASK_PLANNER_TOKENIZER_ID}:${text.length.toString()}:${hash}`;
}

/**
 * 进程内 LRU token metric cache，专供任务规划复用精确 token 计数，不引入持久化派生事实。
 */
export class TaskTokenMetricCache {
  private readonly capacity: number; // capacity 是 LRU 上限，避免大型项目反复规划后无限增长。
  private readonly cache = new Map<string, TaskTokenMetric>(); // cache 使用 Map 插入顺序表达 LRU。

  /**
   * 注入容量便于测试验证驱逐行为，生产默认使用固定上限。
   */
  public constructor(capacity = TASK_TOKEN_METRIC_CACHE_CAPACITY) {
    this.capacity = Math.max(1, Math.trunc(capacity));
  }

  /**
   * 读取指标并刷新 LRU 顺序；未命中时返回 null，调用方再调度 planning worker。
   */
  public get(cache_key: string): TaskTokenMetric | null {
    const metric = this.cache.get(cache_key);
    if (metric === undefined) {
      return null;
    }
    this.cache.delete(cache_key);
    this.cache.set(cache_key, metric);
    return metric;
  }

  /**
   * 写入精确指标；相同 key 覆盖并成为最新项。
   */
  public set(cache_key: string, metric: TaskTokenMetric): void {
    this.cache.delete(cache_key);
    this.cache.set(cache_key, {
      token_count: Math.max(0, Math.trunc(metric.token_count)),
      line_count: Math.max(0, Math.trunc(metric.line_count)),
    });
    this.evict_overflow();
  }

  /**
   * 测试与诊断可观察当前 cache 大小，生产逻辑不依赖它。
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * 超过容量时删除最旧 key，保持 LRU 上限稳定。
   */
  private evict_overflow(): void {
    while (this.cache.size > this.capacity) {
      const oldest_key = this.cache.keys().next().value;
      if (oldest_key === undefined) {
        return;
      }
      this.cache.delete(oldest_key);
    }
  }
}
