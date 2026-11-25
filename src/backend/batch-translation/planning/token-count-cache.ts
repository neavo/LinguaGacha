const TOKEN_COUNT_CACHE_CAPACITY = 4 * 1024 * 1024; // 按 UTF-16 码元计费，限制跨批次保留的原文规模。
const TOKEN_COUNT_CACHE_ENTRY_COST = 128; // 给短文本设定最低开销，同时限制记录数。

/** 父线程唯一的跨任务计数缓存，命中即跳过线程通信和分词。 */
export class TokenCountCache {
  private readonly cache = new Map<string, number>(); // 插入顺序即 LRU 顺序，零计数也是有效命中。
  private used = 0; // 当前缓存键占用的预算。

  /** 容量只限制跨任务复用，本轮已解析指标由计划独立持有。 */
  public constructor(private readonly capacity = TOKEN_COUNT_CACHE_CAPACITY) {}

  /** 命中刷新访问顺序，undefined 交由规划器安排计数。 */
  public get(text: string): number | undefined {
    const count = this.cache.get(text);
    if (count !== undefined) {
      this.cache.delete(text);
      this.cache.set(text, count);
    }
    return count;
  }

  /** 能放入预算的原文直接作键，超长文本只在本轮去重。 */
  public set(text: string, count: number): void {
    const cost = Math.max(text.length, TOKEN_COUNT_CACHE_ENTRY_COST);
    if (cost > this.capacity) return;
    if (!this.cache.delete(text)) this.used += cost;
    this.cache.set(text, count);
    for (const oldest of this.cache.keys()) {
      if (this.used <= this.capacity) break;
      this.cache.delete(oldest);
      this.used -= Math.max(oldest.length, TOKEN_COUNT_CACHE_ENTRY_COST);
    }
  }
}
