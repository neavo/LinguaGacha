import { read_json_record } from "../../../domain/json";
import { AppError, log_error_from_message, type LogError } from "../../../shared/error";
import { collect_api_keys, read_request_timeout_ms } from "../../llm/llm-request";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";
import type { TranslationRequestPort } from "../protocol/translation-request";
import type {
  BatchTranslationRequestRecovery,
  BatchTranslationRequestState,
} from "../../../domain/batch-translation";
import {
  AUTO_CONCURRENCY_MIN,
  AUTO_CONCURRENCY_MAX,
  resolve_request_limits,
  type TranslationRequestRate,
} from "./request-rate";

const KEY_COOLDOWN_STEPS_MS = [15_000, 30_000, 60_000] as const;
const HTTP_TOO_MANY_REQUESTS = 429;

interface RequestKey {
  value: string;
  failures: number; // 连续故障轮次决定退避，同一波并发失败只计一次。
  in_flight: number; // 本密钥的请求全部结束后才能进入冷却。
  state: "ready" | "draining" | "cooling" | "probing"; // 区分正常并发与单次恢复派发。
  available_at: number; // 0 表示未定时，429 在收束期记录最晚恢复时间，其余故障在收束后定时。
}

interface PendingRequest {
  body: LLMRequestBody;
  signal: AbortSignal;
  resolve: (result: LLMRequestResult) => void;
  reject: (error: unknown) => void;
  abort: () => void;
  usage: { input_tokens: number; reasoning_tokens: number; output_tokens: number }; // 随逻辑请求跨密钥累计。
}

interface SchedulerOptions {
  model: LLMRequestBody["model"];
  client: LLMClientPort;
  rate: TranslationRequestRate;
  on_state: (state: BatchTranslationRequestState) => void; // 同步写入运行态，异步发布错误由 Runtime 完成链收束。
  on_failure: (key_index: number, error: LogError) => void;
}

/** 本轮唯一请求队列；每次真实派发才匹配密钥，同时取得并发与速率资格。 */
export class TranslationRequestScheduler implements TranslationRequestPort {
  private readonly keys: RequestKey[];
  private readonly queue: PendingRequest[] = [];
  private recovery_retry_count = 0; // 本次连续全部不可用期间真正派发的恢复请求总数。
  private offset = 0; // 下次轮换扫描密钥的起点。
  private in_flight = 0; // 全模型实际并发；密钥内计数另用于故障收束。
  private readonly auto_concurrency: boolean; // 本轮配置快照决定是否允许升降档。
  private concurrency_limit: number; // 本轮唯一并发额度，流水线只读取。
  private concurrency_version = 0; // 每次有效 429 更新，隔离降档前的成功与同波故障。
  private timer: ReturnType<typeof setTimeout> | null = null; // 速率等待与密钥冷却共用一个唤醒点。

  /** 每轮按唯一密钥建立恢复状态；速率时钟由外部跨轮复用。 */
  public constructor(private readonly options: SchedulerOptions) {
    const model = read_json_record(options.model);
    const limits = resolve_request_limits(model);
    this.auto_concurrency = limits.auto_concurrency;
    this.concurrency_limit = limits.concurrency_limit;
    options.rate.set_rps_limit(this.concurrency_limit);
    this.keys = [...new Set(collect_api_keys(String(model["api_key"] ?? "")))].map((value) => ({
      value,
      failures: 0,
      in_flight: 0,
      state: "ready",
      available_at: 0,
    }));
  }

  /** 流水线据此供应 work unit，额度只由请求完成路径修改。 */
  public read_concurrency_limit(): number {
    return this.concurrency_limit;
  }

  /** 一个 Promise 对应一个逻辑请求，换密钥重试仍留在本轮队列。 */
  public request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult> {
    if (signal.aborted) return Promise.reject(new AppError("runtime.cancelled"));
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        body,
        signal,
        resolve,
        reject,
        usage: { input_tokens: 0, reasoning_tokens: 0, output_tokens: 0 },
        abort: () => {
          const index = this.queue.indexOf(pending);
          if (index < 0) return; // 已派发请求由真实客户端的 signal 收束。
          this.queue.splice(index, 1);
          signal.removeEventListener("abort", pending.abort);
          reject(new AppError("runtime.cancelled"));
          this.dispatch();
        },
      };
      signal.addEventListener("abort", pending.abort, { once: true });
      this.queue.push(pending);
      this.dispatch();
    });
  }

  /** 状态变化统一重算下一次唤醒；冷却中的密钥不预留任何批次或并发槽。 */
  private dispatch(): void {
    this.dispatch_pending();
    this.options.on_state(
      Object.freeze({
        request_in_flight_count: this.in_flight,
        request_recovery: this.read_recovery(),
      }),
    );
  }

  /** 真实派发与等待共用同一组资格，恢复截止时间也从这里读取。 */
  private dispatch_pending(): void {
    if (this.keys.some((key) => key.state === "ready")) this.recovery_retry_count = 0;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.length > 0 && this.in_flight < this.concurrency_limit) {
      // 同一个 signal 的 abort 监听依次执行；前一个监听重新派发时，后续请求也已取消。
      const head = this.queue[0]!;
      if (head.signal.aborted) {
        this.queue.shift();
        head.signal.removeEventListener("abort", head.abort);
        head.reject(new AppError("runtime.cancelled"));
        continue;
      }
      const now = Date.now();
      const key_index = this.find_available_key(now);
      const rate_delay = this.options.rate.get_dispatch_permit_delay_ms();
      if (key_index < 0 || rate_delay > 0) {
        const delay = this.read_dispatch_delay(now);
        // 没有冷却截止时间时，等待在途请求完成触发派发。
        if (Number.isFinite(delay))
          this.timer = setTimeout(() => this.dispatch(), Math.ceil(delay));
        return;
      }
      const pending = this.queue.shift()!;
      const key = this.keys[key_index]!;
      this.offset = (key_index + 1) % this.keys.length;
      if (key.state === "cooling") {
        if (this.keys.every((candidate) => candidate.state !== "ready"))
          this.recovery_retry_count += 1;
        key.state = "probing";
        key.available_at = 0;
      }
      key.in_flight += 1;
      this.in_flight += 1;
      this.options.rate.consume_dispatch_permit(now);
      void this.execute(pending, key, key_index);
    }
  }

  /** 冷却和速率共同决定下一次派发，收束中的密钥依靠请求完成唤醒。 */
  private read_dispatch_delay(now: number): number {
    const key_delay =
      this.find_available_key(now) >= 0
        ? 0
        : Math.min(
            ...this.keys
              .filter((key) => key.state === "cooling")
              .map((key) => Math.max(0, key.available_at - now)),
          );
    return Math.max(key_delay, this.options.rate.get_dispatch_permit_delay_ms());
  }

  /** 页面只读取恢复事实；正常并发占满和独立速率等待不构成密钥故障。 */
  private read_recovery(): BatchTranslationRequestRecovery | null {
    if (
      this.keys.some((key) => key.state === "ready") ||
      (this.queue.length === 0 && this.in_flight === 0)
    )
      return null;
    const retry_count = this.recovery_retry_count;
    if (this.keys.some((key) => key.state === "probing"))
      return Object.freeze({ retry_count, retry_at: null });
    const now = Date.now();
    const delay = this.read_dispatch_delay(now);
    if (this.in_flight < this.concurrency_limit && Number.isFinite(delay))
      return Object.freeze({ retry_count, retry_at: now + Math.ceil(delay) });
    return Object.freeze({ retry_count, retry_at: null });
  }

  /** 轮换扫描当前可用密钥，冷却结束的密钥仅取得一次恢复资格。 */
  private find_available_key(now: number): number {
    for (let step = 0; step < this.keys.length; step += 1) {
      const index = (this.offset + step) % this.keys.length;
      const key = this.keys[index]!;
      if (key.state === "ready" || (key.state === "cooling" && key.available_at <= now))
        return index;
    }
    return -1;
  }

  /** 结算真实请求并调整额度，释放在途计数后重新派发或交付结果。 */
  private async execute(
    pending: PendingRequest,
    key: RequestKey,
    key_index: number,
  ): Promise<void> {
    const version = this.concurrency_version; // 每次真实尝试独立取版本，换密钥重试也重新取值。
    let outcome: { result: LLMRequestResult } | { error: unknown } | null = null; // null 表示等待重新派发。
    try {
      const result = await this.options.client.request(
        {
          ...pending.body,
          model: { ...read_json_record(pending.body.model), api_key: key.value },
        },
        pending.signal,
      );
      for (const field of ["input_tokens", "reasoning_tokens", "output_tokens"] as const)
        pending.usage[field] += result[field];
      if (pending.signal.aborted || result.cancelled) {
        outcome = { result: { ...result, ...pending.usage, cancelled: true } };
        if (key.state === "probing") {
          key.state = "cooling";
          key.available_at = Date.now();
        }
      } else if (result.timeout || result.request_error !== undefined) {
        if (result.http_status === HTTP_TOO_MANY_REQUESTS) {
          this.adjust_concurrency(version, false);
          const delay = Math.min(
            result.retry_after_ms ?? 0,
            read_request_timeout_ms(pending.body.config_snapshot),
          );
          key.available_at = Math.max(
            key.available_at,
            (result.http_received_at ?? Date.now()) + delay,
          );
        }
        this.fail_key(key);
        this.options.on_failure(
          key_index,
          result.request_error ?? log_error_from_message("模型请求超时。"),
        );
      } else {
        this.adjust_concurrency(version, true);
        key.failures = 0;
        key.available_at = 0;
        // 正常响应即恢复密钥；仍在收束的并发请求按完成顺序参与最终判断。
        if (key.state !== "draining") key.state = "ready";
        outcome = { result: { ...result, ...pending.usage } };
      }
    } catch (error) {
      // 客户端已将预期网络错误归一；抛出的异常属于基础设施错误，不能惩罚密钥。
      outcome = { error };
    } finally {
      key.in_flight -= 1;
      this.in_flight -= 1;
      if (key.in_flight === 0 && key.state === "draining") {
        if (key.failures === 0) key.state = "ready";
        else this.cool_key(key);
      }
      if (outcome === null && !pending.signal.aborted) this.queue.push(pending);
      else {
        pending.signal.removeEventListener("abort", pending.abort);
        if (outcome === null) pending.reject(new AppError("runtime.cancelled"));
        else if ("error" in outcome) pending.reject(outcome.error);
        else pending.resolve(outcome.result);
      }
      this.dispatch();
    }
  }

  /** 版本同时约束升档和退让；旧请求仍正常参与密钥恢复与结果结算。 */
  private adjust_concurrency(version: number, success: boolean): void {
    if (!this.auto_concurrency || version !== this.concurrency_version) return;
    if (success) {
      this.concurrency_limit = Math.min(AUTO_CONCURRENCY_MAX, this.concurrency_limit + 1);
    } else {
      this.concurrency_limit = Math.max(
        AUTO_CONCURRENCY_MIN,
        Math.floor(this.concurrency_limit / 2),
      );
      this.concurrency_version += 1;
    }
    this.options.rate.set_rps_limit(this.concurrency_limit);
  }

  /** 并发故障收束为首次失败，单个恢复请求才推进后续次数。 */
  private fail_key(key: RequestKey): void {
    key.failures = key.state === "probing" ? key.failures + 1 : 1;
    key.state = "draining"; // 统一由真实请求结算后的收束入口开始冷却。
  }

  /** 收束后统一开始退避，429 的服务端截止时间只能延长等待。 */
  private cool_key(key: RequestKey): void {
    key.state = "cooling";
    const delay = KEY_COOLDOWN_STEPS_MS[Math.min(key.failures, KEY_COOLDOWN_STEPS_MS.length) - 1]!;
    key.available_at = Math.max(key.available_at, Date.now() + delay);
  }
}
