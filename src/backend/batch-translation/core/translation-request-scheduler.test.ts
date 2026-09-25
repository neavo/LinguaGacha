import type { BatchTranslationRequestState } from "../../../domain/batch-translation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log_error_from_message } from "../../../shared/error";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";
import { RequestRatePool } from "./request-rate";
import { TranslationRequestScheduler } from "./translation-request-scheduler";

// 错误文案刻意不含状态码，调度器必须消费结构化 HTTP 事实。
const failure = () => response({ http_status: 429, request_error: log_error_from_message("限流") });

describe("TranslationRequestScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, 120, 15_000],
    [10_000, 120, 15_000],
    [90_000, 120, 90_000],
    [180_000, 120, 120_000],
    [90_000, 10, 15_000],
  ])(
    "429 等待 %s 毫秒、超时 %s 秒时遵循上下限",
    async (retry_after_ms, request_timeout, expected) => {
      const request = vi
        .fn<LLMClientPort["request"]>()
        .mockResolvedValueOnce(
          response({
            ...failure(),
            ...(retry_after_ms === undefined ? {} : { retry_after_ms }),
            http_received_at: 0,
          }),
        )
        .mockResolvedValue(response());
      const { scheduler } = setup(request);
      const result = scheduler.request(
        { ...body(), config_snapshot: { request_timeout } },
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(request).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(2);
      await result;
    },
  );

  it("同波 429 保留最晚服务端截止时间", async () => {
    const first = deferred();
    const second = deferred();
    const request = vi
      .fn<LLMClientPort["request"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(response());
    const { scheduler } = setup(request);
    const results = [1, 2].map(() =>
      scheduler.request(
        { ...body(), config_snapshot: { request_timeout: 120 } },
        new AbortController().signal,
      ),
    );
    first.resolve(response({ ...failure(), retry_after_ms: 90_000, http_received_at: 0 }));
    await vi.advanceTimersByTimeAsync(60_000);
    second.resolve(response({ ...failure(), retry_after_ms: 10_000, http_received_at: 10_000 }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(results);
    expect(request).toHaveBeenCalledTimes(4);
    expect(Date.now()).toBe(90_000);
  });

  // 16 是本次明确要求的并发上限，验证真实升档后的额度。
  it("双零从 4 开始，每次成功升档至 16，新任务重新探测", async () => {
    const request = vi.fn(async () => response());
    const { scheduler } = setup(request, "A", { concurrency_limit: 0, rpm_limit: 0 });
    expect(scheduler.read_concurrency_limit()).toBe(4);
    for (let count = 1; count <= 30; count += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      await scheduler.request(body(), new AbortController().signal);
    }
    expect(scheduler.read_concurrency_limit()).toBe(16);
    expect(
      setup(request, "A", {
        concurrency_limit: 0,
        rpm_limit: 0,
      }).scheduler.read_concurrency_limit(),
    ).toBe(4);
  });

  it.each([
    [64, 0, 64],
    [0, 60, 60],
    [16, 60, 16],
  ])(
    "显式配置并发 %i、RPM %i 时成功和 429 都保持额度",
    async (concurrency_limit, rpm_limit, expected) => {
      let count = 0;
      const { scheduler } = setup(async () => (++count === 1 ? failure() : response()), "A", {
        concurrency_limit,
        rpm_limit,
      });
      const result = scheduler.request(body(), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(scheduler.read_concurrency_limit()).toBe(expected);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(scheduler.read_concurrency_limit()).toBe(expected);
    },
  );

  it("多 Key 同波 429 只退让一次，旧成功不升档，重派请求使用新版本", async () => {
    const attempts: ReturnType<typeof deferred>[] = [];
    const { scheduler } = setup(
      () => {
        const attempt = deferred();
        attempts.push(attempt);
        return attempt.promise;
      },
      "A\nB\nC\nD",
      { concurrency_limit: 0, rpm_limit: 0 },
    );
    const results = [1, 2, 3, 4].map((id) =>
      scheduler.request(body(String(id)), new AbortController().signal),
    );
    expect(attempts).toHaveLength(4);
    attempts[0]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.read_concurrency_limit()).toBe(2);
    expect(attempts).toHaveLength(4); // 在途尚未低于新额度，不能补发。
    attempts[1]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.read_concurrency_limit()).toBe(2);
    attempts[2]!.resolve(response());
    attempts[3]!.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.read_concurrency_limit()).toBe(2);
    expect(attempts).toHaveLength(6);
    attempts[4]!.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.read_concurrency_limit()).toBe(3);
    attempts[5]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.read_concurrency_limit()).toBe(1);
    attempts[6]!.resolve(response());
    await Promise.all(results);
    expect(scheduler.read_concurrency_limit()).toBe(2);
  });

  it("非 429 网络错误和取消不调整额度，内容终态错误仍计请求成功", async () => {
    const request = vi
      .fn<LLMClientPort["request"]>()
      .mockResolvedValueOnce(response({ timeout: true }))
      .mockResolvedValueOnce(
        response({ http_status: 401, request_error: log_error_from_message("认证失败") }),
      )
      .mockResolvedValueOnce(response({ response_error: log_error_from_message("截断") }))
      .mockResolvedValueOnce(response({ cancelled: true }));
    const { scheduler } = setup(request, "A", { concurrency_limit: 0, rpm_limit: 0 });
    const result = scheduler.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.read_concurrency_limit()).toBe(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(scheduler.read_concurrency_limit()).toBe(4);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(scheduler.read_concurrency_limit()).toBe(5);
    await scheduler.request(body(), new AbortController().signal);
    expect(scheduler.read_concurrency_limit()).toBe(5);
  });

  it("持续 429 退让至 1，冷却中取消立即结算且不再唤醒", async () => {
    const request = vi.fn(async () => failure());
    const { scheduler, state } = setup(request, "A", { concurrency_limit: 0, rpm_limit: 0 });
    const controller = new AbortController();
    const result = scheduler.request(body(), controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(105_000);
    expect(scheduler.read_concurrency_limit()).toBe(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(state).toHaveBeenLastCalledWith({
      request_in_flight_count: 0,
      request_recovery: { retry_count: 3, retry_at: 165_000 },
    });
    controller.abort();
    expect(await result).toMatchObject({ code: "runtime.cancelled" });
    expect(state).toHaveBeenLastCalledWith({ request_in_flight_count: 0, request_recovery: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("失败批次立即转用健康 Key，冷却不占请求压力或等待原 Key", async () => {
    const calls: string[] = [];
    const run_ids: string[] = [];
    const { scheduler, state, failures } = setup(async (body) => {
      const key = (body.model as { api_key: string }).api_key;
      calls.push(key);
      run_ids.push(body.run_id);
      return key === "A" ? failure() : response();
    }, "A\nB");
    expect(await scheduler.request(body(), new AbortController().signal)).toMatchObject({
      response_result: "ok",
    });
    expect(calls).toEqual(["A", "B"]);
    expect(run_ids).toEqual(["run", "run"]);
    expect(Date.now()).toBe(0);
    expect(state).toHaveBeenLastCalledWith({ request_in_flight_count: 0, request_recovery: null });
    expect(failures).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("按 15、30、60、60 秒恢复，超过原次数上限后仍交付响应与累计用量", async () => {
    const started_at: number[] = [];
    const request = vi.fn(async () => {
      started_at.push(Date.now());
      return response({ timeout: started_at.length <= 4, input_tokens: 2 });
    });
    const { scheduler, state } = setup(request);
    const result = scheduler.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenLastCalledWith({
      request_in_flight_count: 0,
      request_recovery: { retry_count: 0, retry_at: 15_000 },
    });
    for (const delay of [1, 30_000, 60_000, 60_000]) await vi.advanceTimersByTimeAsync(delay);
    expect(started_at).toEqual([0, 15_000, 45_000, 105_000, 165_000]);
    expect(await result).toMatchObject({ response_result: "ok", input_tokens: 10 });
    expect(state).toHaveBeenLastCalledWith({ request_in_flight_count: 0, request_recovery: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("网络恢复即重置退避与连续不可用计数，内容错误由调用者处理", async () => {
    let count = 0;
    const { scheduler, state } = setup(async () =>
      ++count % 2 === 0
        ? response({ response_error: log_error_from_message("length") })
        : failure(),
    );
    for (let run = 0; run < 2; run += 1) {
      const result = scheduler.request(body(), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(state.mock.lastCall?.[0].request_recovery).toMatchObject({ retry_count: 0 });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await result).toHaveProperty("response_error");
      expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    }
    expect(count).toBe(4);
  });

  it("同波并发失败只计一次，收束后单请求探测，探测失败才升档", async () => {
    const active = [deferred(), deferred(), deferred(), deferred(), deferred()];
    let count = 0;
    const { scheduler, state } = setup(() =>
      count < active.length ? active[count++]!.promise : Promise.resolve(response()),
    );
    const results = [1, 2, 3].map((id) =>
      scheduler.request(body(String(id)), new AbortController().signal),
    );
    active[0]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(3);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      retry_at: null,
      retry_count: 0,
    });
    active[1]!.resolve(failure());
    active[2]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(count).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(count).toBe(4);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({ retry_at: null, retry_count: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(4);
    active[3]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(29_999);
    expect(count).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(count).toBe(5);
    active[4]!.resolve(response());
    expect((await Promise.all(results)).every((result) => result.response_result === "ok")).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("多密钥共用连续不可用计数，最早派发时间包含 RPM，探测中取消保留信号", async () => {
    const probe = deferred();
    let calls = 0;
    let probe_signal: AbortSignal | undefined;
    const { scheduler, state } = setup(
      async (_body, signal) => {
        calls += 1;
        if (calls === 4) {
          probe_signal = signal;
          return probe.promise;
        }
        return failure();
      },
      "A\nB",
      { concurrency_limit: 2, rpm_limit: 1 },
    );
    const controller = new AbortController();
    const result = scheduler.request(body(), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    // B 仍健康，只有速率等待，不能显示密钥警告。
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      retry_count: 0,
      retry_at: 120_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      retry_count: 1,
      retry_at: 180_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({ retry_at: null, retry_count: 2 });
    controller.abort();
    expect(probe_signal?.aborted).toBe(true);
    probe.resolve(response({ cancelled: true }));
    expect(await result).toMatchObject({ cancelled: true });
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
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

  it("基础设施异常直接拒绝请求，不进入密钥恢复", async () => {
    const error = new Error("worker infrastructure");
    const { scheduler, failures, state } = setup(async () => {
      throw error;
    });
    await expect(scheduler.request(body(), new AbortController().signal)).rejects.toBe(error);
    expect(failures).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith({ request_in_flight_count: 0, request_recovery: null });
  });

  it("共享 signal 取消多个排队请求时，监听回流不能再发出请求", async () => {
    const request = vi.fn(async () => response());
    const { scheduler } = setup(request, "A", { concurrency_limit: 1, rpm_limit: 60 });
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
      { concurrency_limit: 1, rpm_limit: 60 },
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
  threshold = { concurrency_limit: 8, rpm_limit: 0 },
) {
  const state = vi.fn<(state: BatchTranslationRequestState) => void>();
  const failures = vi.fn();
  const model = { api_key: keys, threshold };
  return {
    state,
    failures,
    scheduler: new TranslationRequestScheduler({
      model,
      client: { request },
      rate: new RequestRatePool().resolve(model),
      on_state: state,
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
