// 默认并发与实施计划一致，未显式设置时不再按 RPM 反推 worker 数。
const DEFAULT_CONCURRENCY_LIMIT = 8;
const ONE_MINUTE_MS = 60_000;

interface TaskLimiterOptions {
  concurrency_limit?: number;
  rpm_limit?: number;
  now?: () => number;
}

/**
 * Task Engine 限流器，统一持有并发槽和每分钟请求数节奏。
 */
export class TaskLimiter {
  // max_concurrency 是 worker 同时发出 Python work unit 的上限。
  public readonly max_concurrency: number;

  // rpm_limit 只表示每分钟请求数，不参与反推并发。
  private readonly rpm_limit: number;

  // now_provider 让限流测试可以注入虚拟时钟。
  private readonly now_provider: () => number;

  // in_use 记录已占用并发槽的请求数量。
  private in_use = 0;

  // request_timestamps 记录最近一分钟内真正放行的请求。
  private request_timestamps: number[] = [];

  // waiters 在 release 时被唤醒，避免无槽时忙等。
  private waiters: Array<() => void> = [];

  /**
   * 初始化限流参数；显式并发必须大于 0，否则固定回退 8。
   */
  public constructor(options: TaskLimiterOptions = {}) {
    const raw_concurrency = Math.trunc(Number(options.concurrency_limit ?? 0));
    this.max_concurrency = raw_concurrency > 0 ? raw_concurrency : DEFAULT_CONCURRENCY_LIMIT;
    this.rpm_limit = Math.max(0, Math.trunc(Number(options.rpm_limit ?? 0)));
    this.now_provider = options.now ?? (() => Date.now());
  }

  /**
   * 申请一次请求资格；调用方必须在 work unit 返回后执行 release。
   */
  public async acquire(signal: AbortSignal): Promise<() => void> {
    for (;;) {
      this.throw_if_aborted(signal);
      this.compact_request_timestamps();
      const rpm_delay_ms = this.get_rpm_delay_ms();
      if (this.in_use < this.max_concurrency && rpm_delay_ms <= 0) {
        this.in_use += 1;
        this.request_timestamps.push(this.now_provider());
        return () => this.release();
      }
      if (this.in_use >= this.max_concurrency) {
        await this.wait_for_release(signal);
      } else {
        await this.delay(rpm_delay_ms, signal);
      }
    }
  }

  /**
   * 释放并发槽并唤醒一个等待者，保持后续队列继续推进。
   */
  private release(): void {
    this.in_use = Math.max(0, this.in_use - 1);
    const waiter = this.waiters.shift();
    waiter?.();
  }

  /**
   * 清理一分钟窗口外的请求时间戳，保证 RPM 判断只看当前窗口。
   */
  private compact_request_timestamps(): void {
    if (this.rpm_limit <= 0) {
      this.request_timestamps = [];
      return;
    }
    const cutoff = this.now_provider() - ONE_MINUTE_MS;
    this.request_timestamps = this.request_timestamps.filter((timestamp) => timestamp > cutoff);
  }

  /**
   * 返回下一次可发请求还需等待多久；0 表示已有 RPM 令牌。
   */
  private get_rpm_delay_ms(): number {
    if (this.rpm_limit <= 0 || this.request_timestamps.length < this.rpm_limit) {
      return 0;
    }
    const oldest_timestamp = this.request_timestamps[0] ?? this.now_provider();
    return Math.max(0, oldest_timestamp + ONE_MINUTE_MS - this.now_provider());
  }

  /**
   * 等待任意并发槽释放；停止时要立刻退出等待。
   */
  private async wait_for_release(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const on_abort = (): void => {
        this.waiters = this.waiters.filter((waiter) => waiter !== resolve);
        reject(new Error("任务已停止。"));
      };
      if (signal.aborted) {
        reject(new Error("任务已停止。"));
        return;
      }
      signal.addEventListener("abort", on_abort, { once: true });
      this.waiters.push(() => {
        signal.removeEventListener("abort", on_abort);
        resolve();
      });
    });
  }

  /**
   * RPM 等待使用可取消定时器，停止命令不需要等完整窗口。
   */
  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("任务已停止。"));
        return;
      }
      const timer = setTimeout(resolve, Math.max(0, ms));
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("任务已停止。"));
        },
        { once: true },
      );
    });
  }

  /**
   * 所有等待点都先检查 abort，避免停止后继续发新 work unit。
   */
  private throw_if_aborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error("任务已停止。");
    }
  }
}
