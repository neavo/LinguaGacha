const DEFAULT_CONCURRENCY_LIMIT = 8; // 用户未设置并发且未设置 RPM 时，默认同时执行 8 个 LLM work unit
const ONE_MINUTE_MS = 60_000;
const ONE_SECOND_MS = 1_000;
type LimiterModelRecord = Record<string, unknown>;

interface TaskLimiterOptions {
  concurrency_limit?: number;
  rpm_limit?: number;
  max_concurrency?: number;
  now?: () => number;
}

export interface TaskLimiterLease {
  release: () => void; // release 只释放本次 lease，占用方异常重入时保持幂等
  acquired_at: number; // acquired_at 记录资格发放时刻，供测试和未来诊断读取
  queued_ms: number; // queued_ms 表达请求在 limiter 内等待了多久，不进入任务运行态
}

// PendingRequest 是 FIFO 队列中的唯一等待形态，并发等待和 RPM 等待都收敛到这里
interface PendingRequest {
  resolve: (lease: TaskLimiterLease) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  abort_listener: () => void;
  queued_at: number;
  settled: boolean;
}

/**
 * Task Engine 限流器，统一发放 LLM work unit 请求资格并保护外部模型服务节奏。
 */
export class TaskLimiter {
  public readonly max_concurrency: number; // max_concurrency 是实际 in-flight LLM work unit 的上限

  private readonly rpm_limit: number; // rpm_limit 大于 0 时是唯一请求启动速率来源

  private readonly rpm_permit_interval_ms: number; // rpm_permit_interval_ms 是 RPM 模式下相邻请求资格的最小间隔

  private readonly hidden_rps_limit: number; // hidden_rps_limit 只在无 RPM 时等于最终并发值，不暴露为配置项

  private readonly hidden_rps_token_capacity: number; // hidden_rps_token_capacity 允许冷启动填满并发

  private readonly now_provider: () => number; // now_provider 让限流测试可以注入虚拟时钟

  private in_use = 0; // in_use 记录已发放但尚未释放的请求资格数量

  private next_rpm_permit_at: number | null = null; // next_rpm_permit_at 记录下一次 RPM 资格最早可发放时间

  private hidden_rps_tokens: number; // hidden_rps_tokens 是无 RPM 模式下可立即启动的请求资格

  private hidden_rps_refilled_at: number; // hidden_rps_refilled_at 是令牌桶最近一次补充时刻

  private readonly pending_queue: PendingRequest[] = []; // pending_queue 是所有等待请求的 FIFO 权威队列

  private rate_timer: ReturnType<typeof setTimeout> | null = null; // rate_timer 是 RPM pacer 与隐藏 RPS 共用的唯一唤醒定时器

  /**
   * 初始化限流参数；TaskLimiter 只接收最终并发值，不再解释 concurrency_limit == 0。
   */
  public constructor(options: TaskLimiterOptions = {}) {
    const raw_concurrency = Math.trunc(
      Number(options.max_concurrency ?? options.concurrency_limit ?? DEFAULT_CONCURRENCY_LIMIT),
    );
    this.max_concurrency = raw_concurrency > 0 ? raw_concurrency : DEFAULT_CONCURRENCY_LIMIT;
    this.rpm_limit = Math.max(0, Math.trunc(Number(options.rpm_limit ?? 0)));
    this.rpm_permit_interval_ms = this.rpm_limit > 0 ? ONE_MINUTE_MS / this.rpm_limit : 0;
    this.hidden_rps_limit = this.rpm_limit > 0 ? 0 : this.max_concurrency;
    this.hidden_rps_token_capacity = this.hidden_rps_limit;
    this.hidden_rps_tokens = this.hidden_rps_token_capacity;
    this.now_provider = options.now ?? (() => Date.now());
    this.hidden_rps_refilled_at = this.now_provider();
  }

  /**
   * 申请一次请求资格；调用方必须在 work unit 返回后释放 lease。
   */
  public async acquire(signal: AbortSignal): Promise<TaskLimiterLease> {
    if (signal.aborted) {
      throw this.create_abort_error();
    }
    return await new Promise<TaskLimiterLease>((resolve, reject) => {
      const request: PendingRequest = {
        resolve,
        reject,
        signal,
        abort_listener: () => this.cancel_pending_request(request),
        queued_at: this.now_provider(),
        settled: false,
      };
      signal.addEventListener("abort", request.abort_listener, { once: true });
      this.pending_queue.push(request);
      this.drain_queue();
    });
  }

  /**
   * 从 FIFO 队列发放可用资格；并发槽和 RPM 节奏都在同一出口判断。
   */
  private drain_queue(): void {
    this.clear_rate_timer_if_idle();
    while (this.pending_queue.length > 0 && this.in_use < this.max_concurrency) {
      const permit_delay_ms = this.get_dispatch_permit_delay_ms();
      if (permit_delay_ms > 0) {
        this.schedule_rate_timer(permit_delay_ms);
        return;
      }
      const request = this.pending_queue.shift();
      if (request === undefined) {
        return;
      }
      this.grant_request(request);
    }
  }

  /**
   * 发放队首请求资格，同时消耗本次请求启动许可。
   */
  private grant_request(request: PendingRequest): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    request.signal.removeEventListener("abort", request.abort_listener);
    this.in_use += 1;
    const acquired_at = this.now_provider();
    this.consume_dispatch_permit(acquired_at);
    let released = false;
    request.resolve({
      acquired_at,
      queued_ms: Math.max(0, acquired_at - request.queued_at),
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.release();
      },
    });
  }

  /**
   * 释放并发槽后继续 drain，保证取消、限速和并发释放都走同一推进路径。
   */
  private release(): void {
    this.in_use = Math.max(0, this.in_use - 1);
    this.drain_queue();
  }

  /**
   * 取消仍在队列中的请求，清理 abort listener 并让后续队列重新判断。
   */
  private cancel_pending_request(request: PendingRequest): void {
    if (request.settled) {
      return;
    }
    request.settled = true;
    request.signal.removeEventListener("abort", request.abort_listener);
    const index = this.pending_queue.indexOf(request);
    if (index >= 0) {
      this.pending_queue.splice(index, 1);
    }
    request.reject(this.create_abort_error());
    this.clear_rate_timer_if_idle();
    this.drain_queue();
  }

  /**
   * 返回下一次可发请求还需等待多久；0 表示已有启动资格。
   */
  private get_dispatch_permit_delay_ms(): number {
    if (this.rpm_limit > 0) {
      if (this.next_rpm_permit_at === null) {
        return 0;
      }
      return Math.max(0, this.next_rpm_permit_at - this.now_provider());
    }
    this.refill_hidden_rps_tokens(this.now_provider());
    if (this.hidden_rps_tokens >= 1) {
      return 0;
    }
    return ((1 - this.hidden_rps_tokens) / this.hidden_rps_limit) * ONE_SECOND_MS;
  }

  /**
   * 消耗一次启动许可；RPM 推进下一次时间点，无 RPM 则扣减隐藏 RPS 令牌。
   */
  private consume_dispatch_permit(acquired_at: number): void {
    if (this.rpm_limit > 0) {
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
    if (this.hidden_rps_limit <= 0) {
      return;
    }
    const elapsed_ms = Math.max(0, current_time - this.hidden_rps_refilled_at);
    if (elapsed_ms <= 0) {
      return;
    }
    const refill_tokens = (elapsed_ms / ONE_SECOND_MS) * this.hidden_rps_limit;
    this.hidden_rps_tokens = Math.min(
      this.hidden_rps_token_capacity,
      this.hidden_rps_tokens + refill_tokens,
    );
    this.hidden_rps_refilled_at = current_time;
  }

  /**
   * 安排唯一速率定时器，到点后回到 drain_queue 继续发放 FIFO 队首。
   */
  private schedule_rate_timer(delay_ms: number): void {
    if (this.rate_timer !== null) {
      return;
    }
    this.rate_timer = setTimeout(
      () => {
        this.rate_timer = null;
        this.drain_queue();
      },
      Math.max(0, Math.ceil(delay_ms)),
    );
  }

  /**
   * 没有 pending 请求时清掉速率 timer，避免任务停止后残留无意义回调。
   */
  private clear_rate_timer_if_idle(): void {
    if (this.pending_queue.length > 0 || this.rate_timer === null) {
      return;
    }
    clearTimeout(this.rate_timer);
    this.rate_timer = null;
  }

  /**
   * 停止错误统一创建，避免各等待分支产生不同错误文本。
   */
  private create_abort_error(): Error {
    return new Error("任务已停止。");
  }
}

/**
 * LimiterPool 按模型资源键复用 TaskLimiter，让后台任务和单条翻译共享同一外部请求节奏
 */
export class LimiterPool {
  private shared_limiter: { key: string; limiter: TaskLimiter } | null = null; // shared_limiter 是当前模型资源池的唯一缓存

  /**
   * 解析当前模型对应 limiter；影响外部资源池的字段变化时自然切换新 limiter
   */
  public resolve(model: LimiterModelRecord): TaskLimiter {
    const threshold = this.normalize_record(model["threshold"]);
    const key = this.build_key(model, threshold);
    if (this.shared_limiter?.key === key) {
      return this.shared_limiter.limiter;
    }
    const limiter = new TaskLimiter({
      max_concurrency: resolve_effective_concurrency_limit({
        concurrency_limit: this.read_number(threshold["concurrency_limit"], 0),
        rpm_limit: this.read_number(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0),
      }),
      rpm_limit: this.read_number(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0),
    });
    this.shared_limiter = { key, limiter };
    return limiter;
  }

  /**
   * limiter key 只包含会影响外部模型请求池的稳定字段
   */
  private build_key(model: LimiterModelRecord, threshold: LimiterModelRecord): string {
    return JSON.stringify({
      id: String(model["id"] ?? ""),
      api_url: String(model["api_url"] ?? ""),
      model_id: String(model["model_id"] ?? ""),
      concurrency_limit: this.read_number(threshold["concurrency_limit"], 0),
      rpm_limit: this.read_number(threshold["rpm_limit"] ?? threshold["rpm_threshold"], 0),
    });
  }

  /**
   * threshold 必须是普通对象，数组和 null 都按空配置处理
   */
  private normalize_record(value: unknown): LimiterModelRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as LimiterModelRecord)
      : {};
  }

  /**
   * 限流配置保持整数语义，坏值回退到调用方默认值
   */
  private read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
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

  // rpm_limit 仍由 pacer 控制发起速率；并发等于 RPM 不代表突破每分钟请求数。
  const rpm_limit = Math.trunc(Number(options.rpm_limit ?? 0));
  if (rpm_limit > 0) {
    return rpm_limit;
  }

  return DEFAULT_CONCURRENCY_LIMIT;
}
