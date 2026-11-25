import { hash } from "node:crypto";
import { read_json_record, type JsonValue } from "../../domain/json";
import { Model } from "../../domain/model";
import { resolve_model_endpoint } from "../../domain/model-endpoint";
import type { BatchTaskRequestRecovery, BatchTaskRequestState } from "../../domain/batch-task";
import { AppError, log_error_from_message, type LogError } from "../../shared/error";
import { collect_api_keys } from "../llm/llm-request";
import type { LLMRequestFacts } from "../llm/llm-types";
import { create_provider_error } from "../network/provider-error";
import {
  AUTO_CONCURRENCY_MAX,
  AUTO_CONCURRENCY_MIN,
  RequestRate,
  resolve_request_limits,
} from "./request-rate";

const KEY_COOLDOWN_STEPS_MS = [15_000, 30_000, 60_000] as const;
const HTTP_TOO_MANY_REQUESTS = 429;
type RequestLimits = ReturnType<typeof resolve_request_limits>;
type RequestUsage = Pick<
  Required<LLMRequestFacts>,
  "input_tokens" | "reasoning_tokens" | "output_tokens" | "usage_complete"
>;

type RequestKey = {
  value: string;
  failures: number; // 一波在途故障只记一次，单次探测失败才推进。
  in_flight: number;
  state: "ready" | "draining" | "cooling" | "probing";
  available_at: number;
};

interface RunOptions {
  model: JsonValue;
  timeout_ms: number;
  on_state: (state: BatchTaskRequestState) => void;
  on_failure: (key_index: number, error: LogError) => void;
}

interface SessionOptions<Input, Result extends LLMRequestFacts> extends RunOptions {
  dispatch: (input: Input, key: string, signal: AbortSignal) => Promise<Result>;
  is_item_failure?: (result: Result) => boolean;
  on_attempt?: (result: Result) => void;
}

export interface RequestPoolSession<Input, Result extends LLMRequestFacts> {
  /** 上游用共享额度约束待发送的工作量。 */
  read_concurrency_limit(): number;
  /** 一个逻辑请求允许跨密钥重试。 */
  request(input: Input, signal: AbortSignal): Promise<Result>;
  /** 本批收尾后解除会话，释放本批观察者。 */
  close(): void;
}

type RequestRun = {
  controller: AbortController;
  timeout_ms: number;
  in_flight: number;
  queue: PendingRequest[];
  on_state: RunOptions["on_state"];
  on_failure: RunOptions["on_failure"];
  state?: BatchTaskRequestState;
};

type PendingRequest = {
  signal: AbortSignal;
  abort: () => void;
  reject: (error: unknown) => void;
  usage: RequestUsage;
  attempt: (key: string) => Promise<{
    result: LLMRequestFacts;
    item_failure: boolean;
    resolve: (usage: RequestUsage, cancelled?: boolean) => void;
  }>;
};

/** 批量翻译与通用请求共享远端配额，派发仍沿用各批次的执行配置。 */
export class BatchRequestPool {
  private readonly buckets = new Map<string, RequestBucket>();
  private disposed = false;

  /** 每个批次打开一个会话，配置只在此处归并到远端配额。 */
  public open_session<Input, Result extends LLMRequestFacts>(
    options: SessionOptions<Input, Result>,
  ): RequestPoolSession<Input, Result> {
    if (this.disposed) throw new AppError("runtime.disposed");
    const model = read_json_record(options.model);
    const limits = resolve_request_limits(model);
    const oauth = model["auth_type"] === "oauth";
    const keys = oauth ? [""] : [...new Set(collect_api_keys(String(model["api_key"] ?? "")))];
    const fingerprint = oauth ? "oauth" : hash("sha256", JSON.stringify([...keys].sort())); // 空闲桶只保留速率与凭据指纹。
    const endpoint = resolve_model_endpoint(
      String(model["api_url"] ?? ""),
      Model.normalize_api_format(model["api_format"]),
      String(model["model_id"] ?? ""),
    );
    const bucket_key = JSON.stringify([endpoint.base_url, endpoint.model_id, fingerprint, limits]);
    let bucket = this.buckets.get(bucket_key);
    if (bucket === undefined) {
      bucket = new RequestBucket(limits, oauth);
      this.buckets.set(bucket_key, bucket);
    }
    return bucket.open_session(options, keys);
  }

  /** 应用退出时清理全部配额桶。 */
  public dispose(): void {
    this.disposed = true;
    for (const bucket of this.buckets.values()) bucket.dispose();
    this.buckets.clear();
  }
}

/** 并发、速率和密钥状态由同一配额桶协调。 */
class RequestBucket {
  private readonly runs = new Set<RequestRun>();
  private readonly waiting = new Set<RequestRun>(); // 有积压的批次按加入顺序轮转。
  private readonly keys: RequestKey[] = [];
  private readonly rate: RequestRate;
  private in_flight = 0;
  private offset = 0;
  private concurrency_limit: number;
  private concurrency_version = 0;
  private recovery_retry_count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 速率时钟跨批次保留，同一桶独占并发升降档。 */
  constructor(
    private readonly limits: RequestLimits,
    private readonly oauth: boolean,
  ) {
    this.concurrency_limit = limits.concurrency_limit;
    this.rate = new RequestRate({ rps_limit: this.concurrency_limit, rpm_limit: limits.rpm_limit });
  }

  /** 会话拥有本批 FIFO 和取消信号，同桶按会话轮转。 */
  public open_session<Input, Result extends LLMRequestFacts>(
    options: SessionOptions<Input, Result>,
    keys: readonly string[],
  ): RequestPoolSession<Input, Result> {
    const { timeout_ms, on_state, on_failure, dispatch, on_attempt, is_item_failure } = options;
    if (this.keys.length === 0) {
      for (const value of keys)
        this.keys.push({ value, failures: 0, in_flight: 0, state: "ready", available_at: 0 });
    }
    const run: RequestRun = {
      controller: new AbortController(),
      timeout_ms,
      in_flight: 0,
      queue: [],
      on_state,
      on_failure,
    };
    this.runs.add(run);
    return {
      read_concurrency_limit: () => this.concurrency_limit,
      request: (input, request_signal) => {
        const signal = AbortSignal.any([request_signal, run.controller.signal]);
        if (signal.aborted) return Promise.reject(new AppError("runtime.cancelled"));
        return new Promise<Result>((resolve, reject) => {
          const pending: PendingRequest = {
            signal,
            reject,
            usage: { input_tokens: 0, reasoning_tokens: 0, output_tokens: 0, usage_complete: true },
            attempt: async (key) => {
              const result = await dispatch(input, key, signal);
              on_attempt?.(result);
              return {
                result,
                item_failure: is_item_failure?.(result) === true,
                resolve: (usage, cancelled = result.cancelled) =>
                  resolve({ ...result, ...usage, cancelled }),
              };
            },
            abort: () => {
              const index = run.queue.indexOf(pending);
              if (index < 0) return; // 在途请求由传输层响应取消。
              run.queue.splice(index, 1);
              if (run.queue.length === 0) this.waiting.delete(run);
              this.reject_cancelled(pending);
              this.dispatch();
            },
          };
          signal.addEventListener("abort", pending.abort, { once: true });
          this.enqueue(run, pending);
          this.dispatch();
        });
      },
      close: () => {
        if (run.controller.signal.aborted) return;
        this.runs.delete(run);
        run.controller.abort();
        this.dispatch();
      },
    };
  }

  /** 清空队列后再中止在途请求，关闭期间不再派发。 */
  public dispose(): void {
    const runs = [...this.runs];
    this.runs.clear();
    for (const run of this.waiting)
      for (const pending of run.queue.splice(0)) this.reject_cancelled(pending);
    this.waiting.clear();
    for (const run of runs) run.controller.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 待发请求没有传输结果，用统一取消错误结算。 */
  private reject_cancelled(pending: PendingRequest): void {
    pending.signal.removeEventListener("abort", pending.abort);
    pending.reject(new AppError("runtime.cancelled"));
  }

  /** 重试优先于本批还未开始的请求，会话在轮转中的位置照旧。 */
  private enqueue(run: RequestRun, pending: PendingRequest, retry = false): void {
    if (retry) run.queue.unshift(pending);
    else run.queue.push(pending);
    this.waiting.add(run);
  }

  /** 每次取得并发、密钥和速率许可后只派发一项。 */
  private dispatch(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.keys.some((key) => key.state === "ready")) this.recovery_retry_count = 0;
    if (this.runs.size === 0 && this.in_flight === 0 && this.waiting.size === 0) {
      // 活跃争用期结束，保留速率余额和 RPM 截止时刻。
      this.keys.length = 0;
      this.concurrency_limit = this.limits.concurrency_limit;
      this.rate.set_rps_limit(this.concurrency_limit);
      this.offset = 0;
      this.recovery_retry_count = 0;
      return;
    }
    while (this.in_flight < this.concurrency_limit) {
      const run = this.waiting.values().next().value;
      if (run === undefined) break;
      const { queue } = run;
      const pending = queue[0]!;
      if (pending.signal.aborted) {
        queue.shift();
        if (queue.length === 0) this.waiting.delete(run);
        this.reject_cancelled(pending);
        continue;
      }
      const now = Date.now();
      const key_index = this.find_available_key(now);
      if (key_index < 0 || this.rate.get_dispatch_permit_delay_ms() > 0) {
        const delay = this.read_dispatch_delay(now);
        if (Number.isFinite(delay))
          this.timer = setTimeout(() => this.dispatch(), Math.ceil(delay));
        break;
      }
      queue.shift();
      this.waiting.delete(run);
      if (queue.length > 0) this.waiting.add(run);
      const key = this.keys[key_index]!;
      this.offset = (key_index + 1) % this.keys.length;
      if (key.state === "cooling") {
        if (this.keys.every((candidate) => candidate.state !== "ready"))
          this.recovery_retry_count += 1;
        key.state = "probing";
        key.available_at = 0;
      }
      key.in_flight += 1;
      run.in_flight += 1;
      this.in_flight += 1;
      this.rate.consume_dispatch_permit(now);
      void this.execute(run, pending, key, key_index);
    }
    this.publish_states();
  }

  /** 同桶共用恢复截止时间，空闲会话只报告自身压力。 */
  private publish_states(): void {
    const recovery = this.read_recovery();
    for (const run of this.runs) {
      const current = run.in_flight > 0 || this.waiting.has(run) ? recovery : null;
      const previous = run.state;
      const last = previous?.request_recovery;
      if (
        previous?.request_in_flight_count === run.in_flight &&
        last?.phase === current?.phase &&
        (current?.phase !== "waiting" ||
          (last?.phase === "waiting" &&
            last.retry_at === current.retry_at &&
            last.retry_count === current.retry_count))
      )
        continue;
      run.state = { request_in_flight_count: run.in_flight, request_recovery: current };
      run.on_state(run.state);
    }
  }

  /** 最早派发时间同时受密钥和速率限制。 */
  private read_dispatch_delay(now: number): number {
    const key_delay =
      this.find_available_key(now) >= 0
        ? 0
        : Math.min(
            ...this.keys
              .filter((key) => key.state === "cooling")
              .map((key) => Math.max(0, key.available_at - now)),
          );
    return Math.max(key_delay, this.rate.get_dispatch_permit_delay_ms());
  }

  /** 全部密钥不可用时才发布等待或探测状态。 */
  private read_recovery(): BatchTaskRequestRecovery | null {
    if (this.keys.some((key) => key.state === "ready" || key.state === "draining")) return null;
    if (this.keys.some((key) => key.state === "probing")) return { phase: "retrying" };
    if (this.waiting.size === 0) return null;
    const now = Date.now();
    return {
      phase: "waiting",
      retry_count: this.recovery_retry_count,
      retry_at: now + Math.ceil(this.read_dispatch_delay(now)),
    };
  }

  /** 每次派发后从下一个密钥开始查找，冷却到期可试发一次。 */
  private find_available_key(now: number): number {
    for (let step = 0; step < this.keys.length; step += 1) {
      const index = (this.offset + step) % this.keys.length;
      const key = this.keys[index]!;
      if (key.state === "ready" || (key.state === "cooling" && key.available_at <= now))
        return index;
    }
    return -1;
  }

  /** 结算一次物理尝试，换密钥重试时累计同一请求的用量。 */
  private async execute(
    run: RequestRun,
    pending: PendingRequest,
    key: RequestKey,
    key_index: number,
  ): Promise<void> {
    const version = this.concurrency_version;
    let retry = false;
    try {
      const { result, resolve, item_failure } = await pending.attempt(key.value);
      pending.usage.usage_complete &&= result.usage_complete === true;
      for (const field of ["input_tokens", "reasoning_tokens", "output_tokens"] as const)
        pending.usage[field] += result[field];
      if (pending.signal.aborted || result.cancelled) {
        resolve(pending.usage, true);
      } else if (result.timeout || result.request_error !== undefined) {
        run.on_failure(key_index, result.request_error ?? log_error_from_message("模型请求超时。"));
        if (
          result.retryable === false ||
          (this.oauth && key.failures >= KEY_COOLDOWN_STEPS_MS.length)
        ) {
          if (!item_failure)
            throw create_provider_error(
              result.request_error?.message ?? "Model request timed out.",
              result.http_status,
              { retryable: false, failure: result.request_error },
            );
          this.restore_key(key);
          resolve(pending.usage);
        } else {
          if (result.http_status === HTTP_TOO_MANY_REQUESTS) {
            this.adjust_concurrency(version, false);
            const delay = Math.min(result.retry_after_ms ?? 0, run.timeout_ms);
            key.available_at = Math.max(
              key.available_at,
              (result.http_received_at ?? Date.now()) + delay,
            );
          }
          key.failures = key.state === "probing" ? key.failures + 1 : 1;
          key.state = "draining";
          retry = true;
        }
      } else {
        this.adjust_concurrency(version, true);
        this.restore_key(key);
        resolve(pending.usage);
      }
    } catch (error) {
      pending.reject(error);
    } finally {
      key.in_flight -= 1;
      run.in_flight -= 1;
      this.in_flight -= 1;
      if (key.state === "probing") {
        // 取消或异常结束的探测不增加退避，下一批可继续探测。
        key.state = "cooling";
        key.available_at = Date.now();
      } else if (key.in_flight === 0 && key.state === "draining") {
        if (key.failures === 0) key.state = "ready";
        else {
          key.state = "cooling";
          const delay =
            KEY_COOLDOWN_STEPS_MS[Math.min(key.failures, KEY_COOLDOWN_STEPS_MS.length) - 1]!;
          key.available_at = Math.max(key.available_at, Date.now() + delay);
        }
      }
      if (retry && !pending.signal.aborted) this.enqueue(run, pending, true);
      else if (retry) this.reject_cancelled(pending);
      else pending.signal.removeEventListener("abort", pending.abort);
      this.dispatch();
    }
  }

  /** 成功回执清空故障历史，在途旧请求仍需完成收束。 */
  private restore_key(key: RequestKey): void {
    key.failures = 0;
    key.available_at = 0;
    if (key.state !== "draining") key.state = "ready";
  }

  /** 同一波 429 只降档一次，降档前的成功回执也不回抬额度。 */
  private adjust_concurrency(version: number, success: boolean): void {
    if (!this.limits.auto_concurrency || version !== this.concurrency_version) return;
    if (success) {
      this.concurrency_limit = Math.min(AUTO_CONCURRENCY_MAX, this.concurrency_limit + 1);
    } else {
      this.concurrency_limit = Math.max(
        AUTO_CONCURRENCY_MIN,
        Math.floor(this.concurrency_limit / 2),
      );
      this.concurrency_version += 1;
    }
    this.rate.set_rps_limit(this.concurrency_limit);
  }
}
