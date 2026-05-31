import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

export const TOKEN_COUNTER_CACHE_CAPACITY = 8192; // 短文本缓存容量对齐旧版全局 LRU，但只保留运行期服务内缓存
export const TOKEN_COUNTER_CACHEABLE_TEXT_MAX_LENGTH = 2048; // 超过该长度的文本直接计数，避免长文本挤占重复短句缓存

/**
 * TaskEngine 只依赖窄计数接口，tokenizer 细节不能扩散到 item、数据库或公开 DTO
 */
export interface TokenCounter {
  /**
   * 返回给切块预算使用的 token 数量，不能写入任务统计事实
   */
  count(text: string): number;
}

/**
 * 底层 tokenizer 适配器，测试可用轻量假实现观察缓存行为
 */
export interface TokenCounterEncoder {
  /**
   * 暴露 tokenizer 的 token 序列，CachedTokenCounter 只消费长度
   */
  encode(text: string): number[];
}

/**
 * 带短文本 LRU 的 token 计数器，缓存生命周期跟随 TaskEngine 运行实例
 */
export class CachedTokenCounter implements TokenCounter {
  private readonly encoder: TokenCounterEncoder; // 唯一真实计数来源，缓存只复用它的历史结果
  private readonly cache = new Map<string, number>(); // 用 Map 插入顺序表达 LRU，不把状态写入 item 对象

  /**
   * 注入底层 tokenizer，生产路径使用 o200k_base，测试路径使用可观察假 encoder
   */
  public constructor(encoder: TokenCounterEncoder) {
    this.encoder = encoder;
  }

  /**
   * 返回真实 tokenizer 计数；短文本命中缓存时刷新 LRU 顺序
   */
  public count(text: string): number {
    if (!this.is_cacheable_text(text)) {
      return this.count_uncached(text);
    }
    const cached_count = this.cache.get(text); // 使用 undefined 区分未命中，0 token 空字符串仍可缓存
    if (cached_count !== undefined) {
      this.refresh_cache_entry(text, cached_count);
      return cached_count;
    }
    const token_count = this.count_uncached(text); // 写入 LRU 的唯一值，后续命中不重新编码
    this.cache.set(text, token_count);
    this.evict_overflow();
    return token_count;
  }

  /**
   * 真实计数只由底层 tokenizer 完成，空字符串保持 tokenizer 的 0 token 结果
   */
  private count_uncached(text: string): number {
    return this.encoder.encode(text).length;
  }

  /**
   * LRU 只缓存短文本，长文本重复出现时也不污染短句命中率
   */
  private is_cacheable_text(text: string): boolean {
    return text.length <= TOKEN_COUNTER_CACHEABLE_TEXT_MAX_LENGTH;
  }

  /**
   * Map 重新插入 key 即可把命中项移动到最新位置
   */
  private refresh_cache_entry(text: string, token_count: number): void {
    this.cache.delete(text);
    this.cache.set(text, token_count);
  }

  /**
   * 超过固定容量时删除最旧 key，保证缓存不会随项目规模无限增长
   */
  private evict_overflow(): void {
    if (this.cache.size <= TOKEN_COUNTER_CACHE_CAPACITY) {
      return;
    }
    const oldest_key = this.cache.keys().next().value; // 来自 Map 插入顺序，代表当前 LRU 队首
    if (oldest_key !== undefined) {
      this.cache.delete(oldest_key);
    }
  }
}

/**
 * o200k_base tokenizer 适配器，统一把特殊 token 字面量当作普通源文本处理
 */
class O200kBaseTokenEncoder implements TokenCounterEncoder {
  private readonly tokenizer = new Tiktoken(o200k_base); // 生产真实计数器，特殊 token 策略只在本适配器收口

  /**
   * 禁止特殊 token 解析和禁止列表，让 `<|...|>` 片段按普通文本计数而不是抛错
   */
  public encode(text: string): number[] {
    return this.tokenizer.encode(text, [], []);
  }
}

/**
 * 创建生产默认计数器，统一使用旧版已确认的 o200k_base tokenizer
 */
export function create_o200k_base_token_counter(): TokenCounter {
  return new CachedTokenCounter(new O200kBaseTokenEncoder());
}
