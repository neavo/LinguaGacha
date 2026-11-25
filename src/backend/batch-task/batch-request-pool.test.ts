import type { BatchTaskRequestState } from "../../domain/batch-task";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log_error_from_message } from "../../shared/error";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../llm/llm-types";
import { BatchRequestPool } from "./batch-request-pool";

// 错误文案刻意不含状态码，调度器必须消费结构化 HTTP 事实。
const failure = () => response({ http_status: 429, request_error: log_error_from_message("限流") });

describe("BatchRequestPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("同一远端资源共用并发与 RPM，并在积压批次间轮转", async () => {
    const pool = new BatchRequestPool();
    const first = deferred();
    const dispatch = vi.fn((id: string) =>
      id === "a0" ? first.promise : Promise.resolve(response()),
    );
    const model = {
      api_url: "https://example.test/v1/chat/completions",
      model_id: "shared",
      api_key: "A\nB\nA",
      threshold: { concurrency_limit: 1, rpm_limit: 60 },
    };
    const options = { timeout_ms: 120_000, dispatch, on_state: vi.fn(), on_failure: vi.fn() };
    const a = pool.open_session({ ...options, model: { ...model, id: "text" } });
    const b = pool.open_session({
      ...options,
      model: { ...model, id: "media", api_url: "https://example.test/v1", api_key: "B\nA" },
    });
    const signal = new AbortController().signal;
    const finished = Promise.all([
      a.request("a0", signal),
      a.request("a1", signal),
      a.request("a2", signal),
      b.request("b0", signal),
    ]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dispatch.mock.calls).toEqual([["a0", "A", expect.any(AbortSignal)]]);
    first.resolve(response());
    await vi.advanceTimersByTimeAsync(999);
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(["a0", "a1"]);
    await vi.advanceTimersByTimeAsync(1_001);
    await finished;
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(["a0", "a1", "b0", "a2"]);
    pool.dispose();
  });

  it("跨批次共享退让和冷却时刻，取消一批保留另一批的恢复资格", async () => {
    const pool = new BatchRequestPool();
    const first = deferred();
    const second = deferred();
    const dispatch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(response());
    const model = { api_key: "key" };
    const options = { model, dispatch, timeout_ms: 120_000, on_failure: vi.fn() };
    const state_a = vi.fn<(state: BatchTaskRequestState) => void>();
    const state_b = vi.fn<(state: BatchTaskRequestState) => void>();
    const a = pool.open_session({ ...options, on_state: state_a });
    const b = pool.open_session({ ...options, on_state: state_b });
    const controller = new AbortController();
    const cancelled = a.request("a", controller.signal).catch((error: unknown) => error);
    const waiting = b.request("b", new AbortController().signal);
    expect(state_a.mock.lastCall?.[0].request_in_flight_count).toBe(1);
    expect(state_b.mock.lastCall?.[0].request_in_flight_count).toBe(1);
    first.resolve(failure());
    second.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    const recovery = { phase: "waiting", retry_count: 0, retry_at: 15_000 };
    expect(state_a.mock.lastCall?.[0].request_recovery).toEqual(recovery);
    expect(state_b.mock.lastCall?.[0].request_recovery).toEqual(recovery);
    expect(a.read_concurrency_limit()).toBe(2);
    expect(b.read_concurrency_limit()).toBe(2);
    controller.abort();
    expect(await cancelled).toMatchObject({ code: "runtime.cancelled" });
    expect(state_a.mock.lastCall?.[0].request_recovery).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(waiting).resolves.toMatchObject({ response_result: "ok" });
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(["a", "b", "b"]);
    pool.dispose();
  });

  it("不可重试错误只拒绝对应请求，调用方取消本批后继续派发其它批次", async () => {
    const pool = new BatchRequestPool();
    const model = { api_key: "key", threshold: { concurrency_limit: 1 } };
    const dispatch = vi.fn(async (id: string) =>
      id === "a0"
        ? response({
            http_status: 401,
            retryable: false,
            request_error: log_error_from_message("Authentication failed"),
          })
        : response(),
    );
    const options = {
      model,
      dispatch,
      timeout_ms: 120_000,
      on_state: vi.fn(),
      on_failure: vi.fn(),
    };
    const a = pool.open_session({ ...options });
    const b = pool.open_session({ ...options });
    const controller = new AbortController();
    const failed = a.request("a0", controller.signal);
    const queued = a.request("a1", controller.signal).catch((error: unknown) => error);
    const unaffected = b.request("b0", new AbortController().signal);
    await expect(failed).rejects.toMatchObject({ code: "model.provider_failed" });
    controller.abort();
    expect(await queued).toMatchObject({ code: "runtime.cancelled" });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(unaffected).resolves.toMatchObject({ response_result: "ok" });
    expect(dispatch.mock.calls.map(([id]) => id)).toEqual(["a0", "b0"]);
    pool.dispose();
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
      const { session } = setup(request, "A", undefined, request_timeout * 1_000);
      const result = session.request(
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
    const { session } = setup(request);
    const results = [1, 2].map(() =>
      session.request(
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

  it("原生响应跨恢复保留载荷，单项错误释放探测密钥并继续后续项", async () => {
    const model = { api_key: "native-key", threshold: { concurrency_limit: 1, rpm_limit: 0 } };
    const native_response = { id: "response", status: "completed", output: [] };
    const dispatch = vi.fn(
      async (input: { input: string }, _key: string, _signal: AbortSignal) => ({
        input_tokens: 3,
        reasoning_tokens: 0,
        output_tokens: 1,
        cancelled: false,
        timeout: false,
        response: native_response,
        ...(input.input === "bad"
          ? { retryable: false, request_error: log_error_from_message("Invalid input") }
          : {}),
      }),
    );
    dispatch.mockResolvedValueOnce({
      input_tokens: 2,
      reasoning_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: true,
      response: native_response,
    });
    const on_attempt = vi.fn();
    const session = new BatchRequestPool().open_session({
      model,
      timeout_ms: 120_000,
      dispatch,
      is_item_failure: () => true,
      on_attempt,
      on_state: vi.fn(),
      on_failure: vi.fn(),
    });
    const signal = new AbortController().signal;
    const failed = session.request({ input: "bad" }, signal);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await failed).toMatchObject({ input_tokens: 5, retryable: false });
    const succeeded = session.request({ input: "good" }, signal);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await succeeded).toMatchObject({ input_tokens: 3, response: native_response });
    expect(dispatch.mock.calls.map(([input, key]) => [input.input, key])).toEqual([
      ["bad", "native-key"],
      ["bad", "native-key"],
      ["good", "native-key"],
    ]);
    expect(on_attempt).toHaveBeenCalledTimes(3);
    expect(on_attempt.mock.calls.map(([result]) => result.input_tokens)).toEqual([2, 3, 3]);
  });

  it("同配置切换请求格式仍共用速率资格", async () => {
    const model = {
      id: "shared",
      api_key: "key",
      threshold: { concurrency_limit: 1, rpm_limit: 60 },
    };
    const pool = new BatchRequestPool();
    const common = { model, timeout_ms: 120_000, on_state: vi.fn(), on_failure: vi.fn() };
    const text = pool.open_session({
      ...common,
      dispatch: async (_input: string) => response(),
    });
    await text.request("text", new AbortController().signal);
    text.close();
    const dispatch = vi.fn(async (_input: { input: string }) => ({
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      response: { status: "completed" },
    }));
    const native = pool.open_session({ ...common, dispatch });
    const next = native.request({ input: "native" }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(999);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await next).toMatchObject({ response: { status: "completed" } });
  });

  // 16 是本次明确要求的并发上限，验证真实升档后的额度。
  it("双零从 4 开始，每次成功升档至 16，空闲后重新探测", async () => {
    const pool = new BatchRequestPool();
    const request = vi.fn(async () => response());
    const threshold = { concurrency_limit: 0, rpm_limit: 0 };
    const { session } = setup(request, "A", threshold, 120_000, pool);
    expect(session.read_concurrency_limit()).toBe(4);
    for (let count = 1; count <= 30; count += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      await session.request(body(), new AbortController().signal);
    }
    expect(session.read_concurrency_limit()).toBe(16);
    session.close();
    expect(setup(request, "A", threshold, 120_000, pool).session.read_concurrency_limit()).toBe(4);
    pool.dispose();
  });

  it.each([
    [64, 0, 64],
    [0, 60, 60],
    [16, 60, 16],
  ])(
    "显式配置并发 %i、RPM %i 时成功和 429 都保持额度",
    async (concurrency_limit, rpm_limit, expected) => {
      let count = 0;
      const { session } = setup(async () => (++count === 1 ? failure() : response()), "A", {
        concurrency_limit,
        rpm_limit,
      });
      const result = session.request(body(), new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(session.read_concurrency_limit()).toBe(expected);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(session.read_concurrency_limit()).toBe(expected);
    },
  );

  it("多 Key 同波 429 只退让一次，旧成功不升档，重派请求使用新版本", async () => {
    const attempts: ReturnType<typeof deferred>[] = [];
    const { session } = setup(
      () => {
        const attempt = deferred();
        attempts.push(attempt);
        return attempt.promise;
      },
      "A\nB\nC\nD",
      { concurrency_limit: 0, rpm_limit: 0 },
    );
    const results = [1, 2, 3, 4].map((id) =>
      session.request(body(String(id)), new AbortController().signal),
    );
    expect(attempts).toHaveLength(4);
    attempts[0]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.read_concurrency_limit()).toBe(2);
    expect(attempts).toHaveLength(4); // 在途尚未低于新额度，不能补发。
    attempts[1]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    expect(session.read_concurrency_limit()).toBe(2);
    attempts[2]!.resolve(response());
    attempts[3]!.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(session.read_concurrency_limit()).toBe(2);
    expect(attempts).toHaveLength(6);
    attempts[4]!.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(session.read_concurrency_limit()).toBe(3);
    attempts[5]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.read_concurrency_limit()).toBe(1);
    attempts[6]!.resolve(response());
    await Promise.all(results);
    expect(session.read_concurrency_limit()).toBe(2);
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
    const { session } = setup(request, "A", { concurrency_limit: 0, rpm_limit: 0 });
    const result = session.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.read_concurrency_limit()).toBe(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(session.read_concurrency_limit()).toBe(4);
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(session.read_concurrency_limit()).toBe(5);
    await session.request(body(), new AbortController().signal);
    expect(session.read_concurrency_limit()).toBe(5);
  });

  it("持续 429 退让至 1，冷却中取消立即结算且不再唤醒", async () => {
    const request = vi.fn(async () => failure());
    const { session, state } = setup(request, "A", { concurrency_limit: 0, rpm_limit: 0 });
    const controller = new AbortController();
    const result = session.request(body(), controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(105_000);
    expect(session.read_concurrency_limit()).toBe(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request_in_flight_count: 0,
        request_recovery: { phase: "waiting", retry_count: 3, retry_at: 165_000 },
      }),
    );
    controller.abort();
    expect(await result).toMatchObject({ code: "runtime.cancelled" });
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_in_flight_count: 0, request_recovery: null }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("失败批次立即转用健康 Key，冷却不占请求压力或等待原 Key", async () => {
    const calls: string[] = [];
    const run_ids: string[] = [];
    const { session, state, failures } = setup(async (body) => {
      const key = (body.model as { api_key: string }).api_key;
      calls.push(key);
      run_ids.push(body.run_id);
      return key === "A" ? failure() : response();
    }, "A\nB");
    expect(await session.request(body(), new AbortController().signal)).toMatchObject({
      response_result: "ok",
    });
    expect(calls).toEqual(["A", "B"]);
    expect(run_ids).toEqual(["run", "run"]);
    expect(Date.now()).toBe(0);
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_in_flight_count: 0, request_recovery: null }),
    );
    expect(failures).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("按 15、30、60、60 秒恢复，超过原次数上限后仍交付响应与累计用量", async () => {
    const started_at: number[] = [];
    const request = vi.fn(async () => {
      started_at.push(Date.now());
      return response({ timeout: started_at.length <= 4, input_tokens: 2 });
    });
    const { session, state } = setup(request);
    const result = session.request(body(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(request).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request_in_flight_count: 0,
        request_recovery: { phase: "waiting", retry_count: 0, retry_at: 15_000 },
      }),
    );
    for (const delay of [1, 30_000, 60_000, 60_000]) await vi.advanceTimersByTimeAsync(delay);
    expect(started_at).toEqual([0, 15_000, 45_000, 105_000, 165_000]);
    expect(await result).toMatchObject({ response_result: "ok", input_tokens: 10 });
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_in_flight_count: 0, request_recovery: null }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("网络恢复即重置退避与连续不可用计数，内容错误由调用者处理", async () => {
    let count = 0;
    const { session, state } = setup(async () =>
      ++count % 2 === 0
        ? response({ response_error: log_error_from_message("length") })
        : failure(),
    );
    for (let run = 0; run < 2; run += 1) {
      const result = session.request(body(), new AbortController().signal);
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
    const { session, state } = setup(() =>
      count < active.length ? active[count++]!.promise : Promise.resolve(response()),
    );
    const results = [1, 2, 3].map((id) =>
      session.request(body(String(id)), new AbortController().signal),
    );
    active[0]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(3);
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    active[1]!.resolve(failure());
    active[2]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(count).toBe(3);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      phase: "waiting",
      retry_count: 0,
      retry_at: 75_000,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(count).toBe(4);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({ phase: "retrying" });
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

  it("普通请求在途时抑制并行探测提示，收束后显示重试", async () => {
    const active = [deferred(), deferred(), deferred(), deferred()];
    const request = vi.fn<LLMClientPort["request"]>();
    for (const pending of active) request.mockReturnValueOnce(pending.promise);
    request.mockResolvedValue(response());
    const { session, state } = setup(request, "A\nB", { concurrency_limit: 3, rpm_limit: 60 });
    const results = [1, 2, 3].map((id) =>
      session.request(body(String(id)), new AbortController().signal),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    active[0]!.resolve(failure());
    active[1]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.lastCall?.[0].model).toMatchObject({ api_key: "B" });
    expect(state.mock.lastCall?.[0]).toEqual({
      request_in_flight_count: 2,
      request_recovery: null,
    });
    active[2]!.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({ phase: "retrying" });
    active[3]!.resolve(response());
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(results);
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("多密钥共用连续不可用计数，最早派发时间包含 RPM，探测中取消保留信号", async () => {
    const probe = deferred();
    let calls = 0;
    let probe_signal: AbortSignal | undefined;
    const { session, state } = setup(
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
    const result = session.request(body(), controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    // B 仍健康，只有速率等待，不能显示密钥警告。
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      phase: "waiting",
      retry_count: 0,
      retry_at: 120_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({
      phase: "waiting",
      retry_count: 1,
      retry_at: 180_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.mock.lastCall?.[0].request_recovery).toEqual({ phase: "retrying" });
    controller.abort();
    expect(probe_signal?.aborted).toBe(true);
    probe.resolve(response({ cancelled: true }));
    expect(await result).toMatchObject({ cancelled: true });
    expect(state.mock.lastCall?.[0].request_recovery).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("首次故障收束期间成功恢复，待重试批次继续执行且始终隐藏提示", async () => {
    const first = deferred();
    const second = deferred();
    const request = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(response());
    const { session, state } = setup(request);
    const results = [
      session.request(body("1"), new AbortController().signal),
      session.request(body("2"), new AbortController().signal),
    ];
    first.resolve(failure());
    await vi.advanceTimersByTimeAsync(0);
    second.resolve(response());
    expect((await Promise.all(results)).every((result) => result.response_result === "ok")).toBe(
      true,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(Date.now()).toBe(0);
    expect(state.mock.calls.every(([snapshot]) => snapshot.request_recovery === null)).toBe(true);
  });

  it("在途取消沿原 signal 收束", async () => {
    const in_flight = deferred();
    let active_signal: AbortSignal | undefined;
    const { session } = setup(async (_body, signal) => {
      active_signal = signal;
      return in_flight.promise;
    });
    const controller = new AbortController();
    const result = session.request(body(), controller.signal);
    controller.abort();
    expect(active_signal?.aborted).toBe(true);
    in_flight.resolve(response({ cancelled: true }));
    expect(await result).toMatchObject({ cancelled: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("基础设施异常直接拒绝请求，不进入密钥恢复", async () => {
    const error = new Error("worker infrastructure");
    const { session, failures, state } = setup(async () => {
      throw error;
    });
    await expect(session.request(body(), new AbortController().signal)).rejects.toBe(error);
    expect(failures).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({ request_in_flight_count: 0, request_recovery: null }),
    );
  });

  it("共享 signal 取消多个排队请求时，监听回流不能再发出请求", async () => {
    const request = vi.fn(async () => response());
    const { session } = setup(request, "A", { concurrency_limit: 1, rpm_limit: 60 });
    await session.request(body("first"), new AbortController().signal);
    const controller = new AbortController();
    const pending = ["second", "third"].map((id) =>
      session.request(body(id), controller.signal).catch((error: unknown) => error),
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
    const { session } = setup(
      async (request) => {
        calls.push(request.work_unit_id);
        return calls.length === 1 ? active.promise : response();
      },
      "A\nB",
      { concurrency_limit: 1, rpm_limit: 60 },
    );
    const first = session.request(body("1"), new AbortController().signal);
    const controller = new AbortController();
    const cancelled = session
      .request(body("2"), controller.signal)
      .catch((error: unknown) => error);
    const third = session.request(body("3"), new AbortController().signal);
    controller.abort();
    expect(await cancelled).toMatchObject({ code: "runtime.cancelled" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toEqual(["1"]);
    active.resolve(response());
    await Promise.all([first, third]);
    expect(calls).toEqual(["1", "3"]);
  });
});

/** 构造真实请求池会话，只替换网络与观察回调。 */
function setup(
  request: LLMClientPort["request"],
  keys = "A",
  threshold = { concurrency_limit: 8, rpm_limit: 0 },
  timeout_ms = 120_000,
  pool = new BatchRequestPool(),
) {
  const state = vi.fn<(state: BatchTaskRequestState) => void>();
  const failures = vi.fn();
  const model = { api_key: keys, threshold };
  return {
    state,
    failures,
    session: pool.open_session({
      model,
      timeout_ms,
      dispatch: (body: LLMRequestBody, key, signal) =>
        request({ ...body, model: { ...model, api_key: key } }, signal),
      on_state: state,
      on_failure: failures,
    }),
  };
}

/** 提供完整请求事实，场景仅覆盖相关字段。 */
function response(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
  return {
    usage_complete: true,
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
