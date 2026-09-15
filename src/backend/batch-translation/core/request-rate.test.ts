import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestRatePool,
  TranslationRequestRate,
  resolve_effective_concurrency_limit,
} from "./request-rate";

describe("TranslationRequestRate", () => {
  afterEach(() => vi.useRealTimers());

  it("并发按显式值、RPM、默认值依次解析", () => {
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 16, rpm_limit: 60 })).toBe(16);
    expect(resolve_effective_concurrency_limit({ rpm_limit: 60 })).toBe(60);
    expect(resolve_effective_concurrency_limit({})).toBeGreaterThan(0);
  });

  it("默认节奏允许冷启动填满并发，再按 RPS 补充启动资格", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rate = new TranslationRequestRate({ max_concurrency: 2 });
    rate.consume_dispatch_permit(0);
    rate.consume_dispatch_permit(0);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(500);
    vi.setSystemTime(500);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(0);
    rate.consume_dispatch_permit(500);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(500);
  });

  it("RPM 节奏跨同配置任务保留，修改容量时重新建立时钟", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pool = new RequestRatePool();
    const model = { id: "model", threshold: { concurrency_limit: 2, rpm_limit: 60 } };
    pool.resolve(model).consume_dispatch_permit(0);
    vi.setSystemTime(250);
    expect(pool.resolve(model).get_dispatch_permit_delay_ms()).toBe(750);
    expect(
      pool.resolve({ ...model, threshold: { rpm_limit: 120 } }).get_dispatch_permit_delay_ms(),
    ).toBe(0);
  });
});
