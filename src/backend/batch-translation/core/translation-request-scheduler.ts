import { read_json_record } from "../../../domain/json";
import { AppError, log_error_from_message, type LogError } from "../../../shared/error";
import { collect_api_keys } from "../../llm/llm-client-policy";
import type { LLMClientPort, LLMRequestBody } from "../../llm/llm-types";
import type {
  TranslationRequestPort,
  TranslationRequestResult,
} from "../protocol/translation-request";
import type { TranslationRequestRate } from "./request-rate";

const KEY_FAILURE_LIMIT = 3;
const KEY_COOLDOWN_MS = 30_000;
const KEY_JITTER_MS = 5_000;

interface RequestKey {
  value: string;
  failures: number; // 首次故障与两次间隔恢复；同一波并发失败只占首次机会。
  in_flight: number;
  state: "ready" | "draining" | "cooling" | "probing" | "disabled"; // 区分正常并发与单次恢复派发。
  available_at: number; // 仅 cooling 状态消费的冷却截止时间。
}

interface PendingRequest {
  body: LLMRequestBody;
  signal: AbortSignal;
  resolve: (result: TranslationRequestResult) => void;
  reject: (error: unknown) => void;
  abort: () => void;
  usage: { input_tokens: number; reasoning_tokens: number; output_tokens: number }; // 随逻辑请求跨 Key 累计。
}

interface SchedulerOptions {
  model: LLMRequestBody["model"];
  client: LLMClientPort;
  rate: TranslationRequestRate;
  on_pressure: (delta: number) => void;
  on_failure: (key_index: number, error: LogError) => void;
}

/** 本轮唯一请求队列；每次真实派发才匹配 Key，同时取得并发与速率资格。 */
export class TranslationRequestScheduler implements TranslationRequestPort {
  private readonly keys: RequestKey[];
  private readonly queue: PendingRequest[] = [];
  private offset = 0;
  private in_flight = 0; // 全模型实际并发；Key 内计数另用于故障收束。
  private timer: ReturnType<typeof setTimeout> | null = null; // 速率等待与 Key 冷却共用一个唤醒点。

  /** 每轮按唯一 Key 建立恢复状态；速率时钟由外部跨轮复用。 */
  public constructor(private readonly options: SchedulerOptions) {
    this.keys = [
      ...new Set(collect_api_keys(String(read_json_record(options.model)["api_key"] ?? ""))),
    ].map((value) => ({
      value,
      failures: 0,
      in_flight: 0,
      state: "ready",
      available_at: 0,
    }));
  }

  /** 一个 Promise 对应一个逻辑请求，换 Key 重试仍留在本轮队列。 */
  public request(body: LLMRequestBody, signal: AbortSignal): Promise<TranslationRequestResult> {
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

  /** 状态变化统一重算下一次唤醒；冷却中的 Key 不预留任何批次或并发槽。 */
  private dispatch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.length > 0 && this.in_flight < this.options.rate.max_concurrency) {
      // 同一个 signal 的 abort 监听依次执行；前一个监听重新派发时，后续请求也已取消。
      const head = this.queue[0]!;
      if (head.signal.aborted) {
        this.queue.shift();
        head.signal.removeEventListener("abort", head.abort);
        head.reject(new AppError("runtime.cancelled"));
        continue;
      }
      if (this.keys.every((key) => key.state === "disabled")) {
        for (const pending of this.queue.splice(0)) {
          pending.signal.removeEventListener("abort", pending.abort);
          pending.resolve({
            ...pending.usage,
            response_think: "",
            response_result: "",
            cancelled: false,
            timeout: false,
            keys_exhausted: true,
            request_error: log_error_from_message("本轮翻译的模型 Key 已全部耗尽。"),
          });
        }
        return;
      }
      const now = Date.now();
      const key_index = this.find_available_key(now);
      const rate_delay = this.options.rate.get_dispatch_permit_delay_ms();
      if (key_index < 0 || rate_delay > 0) {
        const key_delay =
          key_index >= 0
            ? 0
            : Math.min(
                ...this.keys
                  .filter((key) => key.state === "cooling")
                  .map((key) => Math.max(0, key.available_at - now)),
              );
        const delay = Math.max(rate_delay, key_delay);
        // 没有冷却截止时间时，等待在途请求完成触发派发。
        if (Number.isFinite(delay))
          this.timer = setTimeout(() => this.dispatch(), Math.ceil(delay));
        return;
      }
      const pending = this.queue.shift()!;
      const key = this.keys[key_index]!;
      this.offset = (key_index + 1) % this.keys.length;
      if (key.state === "cooling") key.state = "probing";
      key.in_flight += 1;
      this.in_flight += 1;
      this.options.rate.consume_dispatch_permit(now);
      void this.execute(pending, key, key_index);
    }
  }

  /** 轮换扫描当前可用 Key，冷却结束的 Key 仅取得一次恢复资格。 */
  private find_available_key(now: number): number {
    for (let step = 0; step < this.keys.length; step += 1) {
      const index = (this.offset + step) % this.keys.length;
      const key = this.keys[index]!;
      if (key.state === "ready" || (key.state === "cooling" && key.available_at <= now))
        return index;
    }
    return -1;
  }

  /** 完成一次真实请求，先释放压力与资格，再结算或重新入队。 */
  private async execute(
    pending: PendingRequest,
    key: RequestKey,
    key_index: number,
  ): Promise<void> {
    let outcome: { result: TranslationRequestResult } | { error: unknown } | null = null; // null 表示等待重新派发。
    let counted = false;
    try {
      this.options.on_pressure(1);
      counted = true;
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
        this.fail_key(key);
        this.options.on_failure(
          key_index,
          result.request_error ?? log_error_from_message("模型请求超时。"),
        );
      } else {
        key.failures = 0;
        // 正常响应即恢复 Key；仍在收束的并发请求按完成顺序参与最终判断。
        if (key.state !== "draining") key.state = "ready";
        outcome = { result: { ...result, ...pending.usage } };
      }
    } catch (error) {
      // 客户端已将预期网络错误归一；抛出的异常属于基础设施错误，不能惩罚 Key。
      outcome = { error };
    } finally {
      key.in_flight -= 1;
      this.in_flight -= 1;
      if (key.in_flight === 0 && key.state === "draining") {
        if (key.failures === 0) key.state = "ready";
        else this.cool_key(key);
      }
      try {
        if (counted) this.options.on_pressure(-1);
      } catch (error) {
        outcome = {
          error:
            outcome !== null && "error" in outcome
              ? new AggregateError([outcome.error, error], "Translation request cleanup failed.")
              : error,
        };
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

  /** 并发故障收束为首次失败，单个恢复请求才推进后续次数。 */
  private fail_key(key: RequestKey): void {
    if (key.state === "probing") {
      key.failures += 1;
      if (key.failures >= KEY_FAILURE_LIMIT) key.state = "disabled";
      else this.cool_key(key);
    } else {
      key.state = "draining";
      key.failures = 1; // 一波并发失败只建立首次故障，恢复尝试由冷却后的单请求承担。
    }
  }

  /** 每轮独立取一次抖动，截止时间属于 Key，批次可以换 Key。 */
  private cool_key(key: RequestKey): void {
    key.state = "cooling";
    key.available_at = Date.now() + KEY_COOLDOWN_MS + (Math.random() * 2 - 1) * KEY_JITTER_MS;
  }
}
