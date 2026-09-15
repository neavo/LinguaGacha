import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestRatePool, TranslationRequestRate } from "./request-rate";

describe("TranslationRequestRate", () => {
  afterEach(() => vi.useRealTimers());

  it("默认节奏允许冷启动填满并发，再按 RPS 补充启动资格", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rate = new TranslationRequestRate({ rps_limit: 2 });
    rate.consume_dispatch_permit(0);
    rate.consume_dispatch_permit(0);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(500);
    vi.setSystemTime(500);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(0);
    rate.consume_dispatch_permit(500);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(500);
  });

  it("升档先按旧速率补充且不赠送令牌，降档裁剪余额", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rate = new TranslationRequestRate({ rps_limit: 2 });
    rate.consume_dispatch_permit(0);
    rate.consume_dispatch_permit(0);
    vi.setSystemTime(250);
    rate.set_rps_limit(4);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(125);
    vi.setSystemTime(1_250);
    rate.set_rps_limit(1);
    rate.consume_dispatch_permit(1_250);
    expect(rate.get_dispatch_permit_delay_ms()).toBe(1_000);
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
