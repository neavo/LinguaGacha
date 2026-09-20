import { read_json_integer, read_json_record } from "../../../domain/json";

export const AUTO_CONCURRENCY_INITIAL = 4; // 自动模式的启动额度与上下界由产品规则固定。
export const AUTO_CONCURRENCY_MIN = 1;
export const AUTO_CONCURRENCY_MAX = 16;
const ONE_MINUTE_MS = 60_000;
const ONE_SECOND_MS = 1_000;
type RequestModelRecord = Record<string, unknown>;
interface RequestRateOptions {
  rpm_limit?: number;
  rps_limit: number;
}

/** 仅持有速率时钟；跨任务复用，派发队列和并发由本轮请求调度器拥有。 */
export class TranslationRequestRate {
  private rps_limit: number; // 默认发起速率与令牌容量，由调度器同步当前并发。
  private readonly rpm_permit_interval_ms: number; // 零表示使用默认令牌桶。
  private next_rpm_permit_at: number | null = null; // 同一模型跨任务保留的下次启动时刻。
  private hidden_rps_tokens: number; // 默认 RPS 的剩余启动资格，升档保留余额。
  private hidden_rps_refilled_at: number; // 余额已结算到的时间，调整速率前按旧值结算。
  /** 使用已解析的额度初始化冷启动资格，后续只在真实派发时扣减。 */
  public constructor(options: RequestRateOptions) {
    this.rps_limit = options.rps_limit;
    const rpm_limit = options.rpm_limit ?? 0;
    this.rpm_permit_interval_ms = rpm_limit > 0 ? ONE_MINUTE_MS / rpm_limit : 0;
    this.hidden_rps_tokens = this.rps_limit;
    this.hidden_rps_refilled_at = Date.now();
  }

  /** 先按旧速率结算；升档不赠送令牌，降档裁剪已有余额。 */
  public set_rps_limit(limit: number): void {
    this.refill_hidden_rps_tokens(Date.now());
    this.rps_limit = limit;
    this.hidden_rps_tokens = Math.min(this.hidden_rps_tokens, limit);
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
    return ((1 - this.hidden_rps_tokens) / this.rps_limit) * ONE_SECOND_MS;
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
    const refill_tokens = (elapsed_ms / ONE_SECOND_MS) * this.rps_limit;
    this.hidden_rps_tokens = Math.min(this.rps_limit, this.hidden_rps_tokens + refill_tokens);
    this.hidden_rps_refilled_at = current_time;
  }
}

/** 同一模型配置跨任务保留 RPM 与默认 RPS 节奏。 */
export class RequestRatePool {
  private shared_rate: { key: string; rate: TranslationRequestRate } | null = null; // 当前模型资源池的唯一缓存

  /** 同一资源和容量复用时钟，配置变化才重新建立启动节奏。 */
  public resolve(model: RequestModelRecord): TranslationRequestRate {
    const limits = resolve_request_limits(model);
    const key = JSON.stringify({
      id: String(model["id"] ?? ""),
      api_url: String(model["api_url"] ?? ""),
      model_id: String(model["model_id"] ?? ""),
      ...limits,
    });
    if (this.shared_rate?.key === key) return this.shared_rate.rate;
    const rate = new TranslationRequestRate({
      rps_limit: limits.concurrency_limit,
      rpm_limit: limits.rpm_limit,
    });
    this.shared_rate = { key, rate };
    return rate;
  }
}

/**
 * 统一解析配置语义：双零启用探测，其余按显式并发或 RPM 确定固定额度。
 */
export function resolve_request_limits(model: RequestModelRecord): Readonly<{
  auto_concurrency: boolean;
  concurrency_limit: number;
  rpm_limit: number;
}> {
  const threshold = read_json_record(model["threshold"]);
  const concurrency_limit = Math.max(0, read_json_integer(threshold["concurrency_limit"], 0));
  const rpm_limit = Math.max(
    0,
    read_json_integer(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0),
  );
  return {
    auto_concurrency: concurrency_limit === 0 && rpm_limit === 0,
    concurrency_limit: concurrency_limit || rpm_limit || AUTO_CONCURRENCY_INITIAL,
    rpm_limit,
  };
}
