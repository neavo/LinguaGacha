import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchTranslationProgress } from "../../../domain/batch-translation";

import { TranslationProgressAccumulator } from "./progress-accumulator";

describe("TranslationProgressAccumulator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("累计 token 时以输入、思考和输出字段重建总数", () => {
    const snapshot = TranslationProgressAccumulator.add_tokens(
      {
        ...TranslationProgressAccumulator.empty(5, 100),
        total_tokens: 999,
        total_input_tokens: 1,
        total_reasoning_tokens: 2,
        total_output_tokens: 2,
      },
      2.9,
      3.1,
      4.1,
    );

    expect(snapshot).toMatchObject({
      total_input_tokens: 3,
      total_reasoning_tokens: 5,
      total_output_tokens: 6,
      total_tokens: 14,
    });
  });

  it("按 start_time 计算耗时并保护无效开始时间", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    const started_at = new Date("2026-01-01T00:00:02.000Z").getTime() / 1000;
    const base: BatchTranslationProgress = {
      ...TranslationProgressAccumulator.empty(1, started_at),
      time: 99,
    };

    expect(TranslationProgressAccumulator.with_elapsed(base).time).toBe(3);
    expect(TranslationProgressAccumulator.with_elapsed({ ...base, start_time: 0 }).time).toBe(0);
  });
});
