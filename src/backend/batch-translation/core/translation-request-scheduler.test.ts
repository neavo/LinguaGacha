import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log_error_from_message } from "../../../shared/error";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";
import { TranslationRequestRate } from "./request-rate";
import { TranslationRequestScheduler } from "./translation-request-scheduler";

const failure = () => response({ request_error: log_error_from_message("429") });

describe("TranslationRequestScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("失败批次立即转用健康 Key，冷却不占请求压力或等待原 Key", async () => {
    const calls: string[] = [];
    const { scheduler, pressure, failures } = setup(async (body) => {
      const key = (body.model as { api_key: string }).api_key;
      calls.push(key);
      return key === "A" ? failure() : response();
    }, "A\nB");
    expect(await scheduler.request(body(), new AbortController().signal)).toMatchObject({
      response_result: "ok",
    });
    expect(calls).toEqual(["A", "B"]);
    expect(Date.now()).toBe(0);
    expect(pressure.mock.calls.map(([delta]) => delta)).toEqual([1, -1, 1, -1]);
    expect(failures).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("单 Key 两次间隔恢复后耗尽，并立即结算后续请求", async () => {
    vi.mocked(Math.random).mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const started_at: number[] = [];
    const request = vi.fn(async () => {
      started_at.push(Date.now());
      return failure();
    });
    const { scheduler, pressure } = setup(request);
    const result = scheduler.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(request).toHaveBeenCalledTimes(1);
    expect(pressure.mock.calls.reduce((sum, [delta]) => sum + delta, 0)).toBe(0);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await result).toMatchObject({ keys_exhausted: true });
    expect(request).toHaveBeenCalledTimes(3);
    const first_delay = started_at[1]! - started_at[0]!;
    const second_delay = started_at[2]! - started_at[1]!;
    expect(first_delay).toBeGreaterThanOrEqual(25_000);
    expect(first_delay).toBeLessThan(30_000);
    expect(second_delay).toBeGreaterThan(30_000);
    expect(second_delay).toBeLessThanOrEqual(35_000);
    expect(await scheduler.request(body(), new AbortController().signal)).toMatchObject({
      keys_exhausted: true,
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("成功响应清零当前 Key，即使内容截断也恢复完整的后续重试机会", async () => {
    let count = 0;
    const { scheduler } = setup(async () =>
      ++count === 2 ? response({ response_error: log_error_from_message("length") }) : failure(),
    );
    const first = scheduler.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await first).toHaveProperty("response_error");
    const second = scheduler.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await second).toMatchObject({ keys_exhausted: true });
    expect(count).toBe(5);
  });

  it("并发故障只占首次机会，收束后每轮只放行一个真实恢复请求", async () => {
    const active = [deferred(), deferred(), deferred(), deferred(), deferred()];
    let count = 0;
    const { scheduler } = setup(() => active[count++]!.promise);
    const results = [1, 2, 3].map((id) =>
      scheduler.request(body(String(id)), new AbortController().signal),
    );
    active[0]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(3); // 另外两个原始请求还在途，尚未开始恢复。
    active[1]!.resolve(failure());
    active[2]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(count).toBe(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(4); // 单个恢复请求未结束，不能并发放行其他请求。
    active[3]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(count).toBe(5);
    active[4]!.resolve(failure());
    expect((await Promise.all(results)).map((result) => result.keys_exhausted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("首次故障收束期间的成功立即清零，待重试批次继续执行", async () => {
    const first = deferred();
    const second = deferred();
    const request = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(response());
    const { scheduler } = setup(request);
    const results = [
      scheduler.request(body("1"), new AbortController().signal),
      scheduler.request(body("2"), new AbortController().signal),
    ];
    first.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    second.resolve(response());
    expect((await Promise.all(results)).every((result) => result.response_result === "ok")).toBe(
      true,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(Date.now()).toBe(0);
  });

  it("在途取消沿原 signal 收束", async () => {
    const in_flight = deferred();
    let active_signal: AbortSignal | undefined;
    const { scheduler } = setup(async (_body, signal) => {
      active_signal = signal;
      return in_flight.promise;
    });
    const controller = new AbortController();
    const result = scheduler.request(body(), controller.signal);
    controller.abort();
    expect(active_signal?.aborted).toBe(true);
    in_flight.resolve(response({ cancelled: true }));
    expect(await result).toMatchObject({ cancelled: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("基础设施异常直接拒绝请求，压力回调失败同样可见", async () => {
    const error = new Error("worker infrastructure");
    const { scheduler, failures, pressure } = setup(async () => {
      throw error;
    });
    await expect(scheduler.request(body(), new AbortController().signal)).rejects.toBe(error);
    expect(failures).not.toHaveBeenCalled();
    expect(pressure.mock.calls.map(([delta]) => delta)).toEqual([1, -1]);
    const other = setup(async () => response());
    other.pressure.mockImplementation((delta) => {
      if (delta < 0) throw error;
    });
    await expect(other.scheduler.request(body(), new AbortController().signal)).rejects.toBe(error);
  });

  it("共享 signal 取消多个排队请求时，监听回流不能再发出请求", async () => {
    const request = vi.fn(async () => response());
    const { scheduler } = setup(
      request,
      "A",
      new TranslationRequestRate({ max_concurrency: 1, rpm_limit: 60 }),
    );
    await scheduler.request(body("first"), new AbortController().signal);
    const controller = new AbortController();
    const pending = ["second", "third"].map((id) =>
      scheduler.request(body(id), controller.signal).catch((error: unknown) => error),
    );
    vi.setSystemTime(1_000);
    controller.abort();
    expect(await Promise.all(pending)).toEqual([
      expect.objectContaining({ code: "runtime.cancelled" }),
      expect.objectContaining({ code: "runtime.cancelled" }),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("并发槽与 RPM 同时满足才发请求，取消队首后后续请求仍按序推进", async () => {
    const active = deferred();
    const calls: string[] = [];
    const { scheduler } = setup(
      async (request) => {
        calls.push(request.work_unit_id);
        return calls.length === 1 ? active.promise : response();
      },
      "A\nB",
      new TranslationRequestRate({ max_concurrency: 1, rpm_limit: 60 }),
    );
    const first = scheduler.request(body("1"), new AbortController().signal);
    const controller = new AbortController();
    const cancelled = scheduler
      .request(body("2"), controller.signal)
      .catch((error: unknown) => error);
    const third = scheduler.request(body("3"), new AbortController().signal);
    controller.abort();
    expect(await cancelled).toMatchObject({ code: "runtime.cancelled" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toEqual(["1"]);
    active.resolve(response());
    await Promise.all([first, third]);
    expect(calls).toEqual(["1", "3"]);
  });
});

/** 构造真实调度器，只替换网络与观察回调。 */
function setup(
  request: LLMClientPort["request"],
  keys = "A",
  rate = new TranslationRequestRate({ max_concurrency: 8 }),
) {
  const pressure = vi.fn<(delta: number) => void>();
  const failures = vi.fn();
  return {
    pressure,
    failures,
    scheduler: new TranslationRequestScheduler({
      model: { api_key: keys },
      client: { request },
      rate,
      on_pressure: pressure,
      on_failure: failures,
    }),
  };
}

/** 提供完整请求事实，场景仅覆盖相关字段。 */
function response(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
  return {
    response_result: "ok",
    response_think: "",
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    cancelled: false,
    timeout: false,
    ...overrides,
  };
}

/** 固定提示词以观察同一逻辑请求的重新派发。 */
function body(id = "unit"): LLMRequestBody {
  return {
    run_id: "run",
    work_unit_id: id,
    model: {},
    config_snapshot: {},
    messages: [{ role: "user", content: id }],
  };
}

/** 由测试决定在途请求完成顺序，覆盖并发恢复。 */
function deferred() {
  let resolve!: (result: LLMRequestResult) => void;
  const promise = new Promise<LLMRequestResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
