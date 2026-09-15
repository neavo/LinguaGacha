import { read_json_integer, read_json_record } from "../../../domain/json";

const DEFAULT_CONCURRENCY_LIMIT = 8;
const ONE_MINUTE_MS = 60_000;
const ONE_SECOND_MS = 1_000;
type RequestModelRecord = Record<string, unknown>;
interface RequestRateOptions {
  rpm_limit?: number;
  max_concurrency: number;
}

/** 仅持有速率时钟；跨任务复用，派发队列和并发由本轮请求调度器拥有。 */
export class TranslationRequestRate {
  public readonly max_concurrency: number; // 同时也是未配置 RPM 时的每秒补充量与令牌上限。
  private readonly rpm_permit_interval_ms: number; // 零表示使用默认令牌桶。
  private next_rpm_permit_at: number | null = null; // 同一模型跨任务保留的下次启动时刻。
  private hidden_rps_tokens: number;
  private hidden_rps_refilled_at: number;
  /** 归一容量并初始化冷启动资格，后续只在真实派发时扣减。 */
  public constructor(options: RequestRateOptions) {
    const raw_concurrency = Math.trunc(Number(options.max_concurrency));
    this.max_concurrency = raw_concurrency > 0 ? raw_concurrency : DEFAULT_CONCURRENCY_LIMIT;
    const rpm_limit = Math.max(0, Math.trunc(Number(options.rpm_limit ?? 0)));
    this.rpm_permit_interval_ms = rpm_limit > 0 ? ONE_MINUTE_MS / rpm_limit : 0;
    this.hidden_rps_tokens = this.max_concurrency;
    this.hidden_rps_refilled_at = Date.now();
  }

  /** 距离下一次启动资格的等待时间；查询不消耗资格。 */
  public get_dispatch_permit_delay_ms(): number {
    if (this.rpm_permit_interval_ms > 0) {
      if (this.next_rpm_permit_at === null) {
        return 0;
      }
      return Math.max(0, this.next_rpm_permit_at - Date.now());
    }
    this.refill_hidden_rps_tokens(Date.now());
    if (this.hidden_rps_tokens >= 1) {
      return 0;
    }
    return ((1 - this.hidden_rps_tokens) / this.max_concurrency) * ONE_SECOND_MS;
  }

  /**
   * 消耗一次启动许可；RPM 推进下一次时间点，无 RPM 则扣减隐藏 RPS 令牌。
   */
  public consume_dispatch_permit(acquired_at: number): void {
    if (this.rpm_permit_interval_ms > 0) {
      this.next_rpm_permit_at = acquired_at + this.rpm_permit_interval_ms;
      return;
    }
    this.refill_hidden_rps_tokens(acquired_at);
    this.hidden_rps_tokens = Math.max(0, this.hidden_rps_tokens - 1);
  }

  /**
   * 按最终并发值补充隐藏 RPS 令牌；令牌上限保证冷启动最多填满并发。
   */
  private refill_hidden_rps_tokens(current_time: number): void {
    const elapsed_ms = Math.max(0, current_time - this.hidden_rps_refilled_at);
    if (elapsed_ms <= 0) {
      return;
    }
    const refill_tokens = (elapsed_ms / ONE_SECOND_MS) * this.max_concurrency;
    this.hidden_rps_tokens = Math.min(this.max_concurrency, this.hidden_rps_tokens + refill_tokens);
    this.hidden_rps_refilled_at = current_time;
  }
}

/** 同一模型配置跨任务保留 RPM 与默认 RPS 节奏。 */
export class RequestRatePool {
  private shared_rate: { key: string; rate: TranslationRequestRate } | null = null; // 当前模型资源池的唯一缓存

  /** 同一资源和容量复用时钟，配置变化才重新建立启动节奏。 */
  public resolve(model: RequestModelRecord): TranslationRequestRate {
    const threshold = read_json_record(model["threshold"]);
    const rpm_limit = read_json_integer(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0);
    const concurrency_limit = read_json_integer(threshold["concurrency_limit"], 0);
    const key = JSON.stringify({
      id: String(model["id"] ?? ""),
      api_url: String(model["api_url"] ?? ""),
      model_id: String(model["model_id"] ?? ""),
      concurrency_limit,
      rpm_limit,
    });
    if (this.shared_rate?.key === key) return this.shared_rate.rate;
    const rate = new TranslationRequestRate({
      max_concurrency: resolve_effective_concurrency_limit({ concurrency_limit, rpm_limit }),
      rpm_limit,
    });
    this.shared_rate = { key, rate };
    return rate;
  }
}

/**
 * 并发推导规则保持固定顺序：显式并发优先；否则 RPM 一比一作为自动并发；两者都没有时回退 8。
 */
export function resolve_effective_concurrency_limit(options: {
  concurrency_limit?: number;
  rpm_limit?: number;
}): number {
  const concurrency_limit = Math.trunc(Number(options.concurrency_limit ?? 0));
  if (concurrency_limit > 0) {
    return concurrency_limit;
  }

  // 仍由 pacer 控制发起速率；并发等于 RPM 不代表突破每分钟请求数。
  const rpm_limit = Math.trunc(Number(options.rpm_limit ?? 0));
  if (rpm_limit > 0) {
    return rpm_limit;
  }

  return DEFAULT_CONCURRENCY_LIMIT;
}
