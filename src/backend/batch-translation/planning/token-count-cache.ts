import crypto from "node:crypto";

const TOKEN_COUNT_CACHE_CAPACITY = 32768;
const TOKEN_COUNT_IDENTITY = "o200k_base:ordinary-specials"; // 编码及特殊标记策略共同决定计数语义。

/** 长文本仅以摘要驻留跨任务缓存，原文和行数由本轮计划拥有。 */
export function build_token_count_cache_key(text: string): string {
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  return `${TOKEN_COUNT_IDENTITY}:${text.length.toString()}:${hash}`;
}

/** 父线程唯一的跨任务计数缓存，命中即跳过线程通信和分词。 */
export class TokenCountCache {
  private readonly cache = new Map<string, number>(); // 插入顺序即 LRU 顺序，零计数也是有效命中。

  /** 容量只限制跨任务复用，本轮已解析指标由计划独立持有。 */
  public constructor(private readonly capacity = TOKEN_COUNT_CACHE_CAPACITY) {}

  /** 命中刷新访问顺序，undefined 交由规划器安排计数。 */
  public get(key: string): number | undefined {
    const count = this.cache.get(key);
    if (count !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, count);
    }
    return count;
  }

  /** 保存已通过计数边界验证的结果，并淘汰最久未访问项。 */
  public set(key: string, count: number): void {
    this.cache.delete(key);
    this.cache.set(key, count);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
