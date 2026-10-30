import { describe, expect, it } from "vitest";

import {
  normalize_batch_translation_config,
  normalize_batch_translation_progress,
  normalize_batch_translation_run_progress,
} from "./batch-translation";

describe("任务运行配置", () => {
  it("配置只保留公开字段，并拒绝不完整或无效的载荷", () => {
    const config = {
      model_name: "翻译模型",
      model_id: "model",
      thinking_level: null,
      source_language: "JA",
      target_language: "ZH",
    };
    expect(normalize_batch_translation_config({ ...config, api_key: "secret" })).toEqual(config);
    for (const invalid of [
      null,
      [],
      {},
      { ...config, model_id: 1 },
      { ...config, thinking_level: "unknown" },
    ]) {
      expect(normalize_batch_translation_config(invalid)).toBeUndefined();
    }
  });
});

describe("任务进度快照", () => {
  it("进度归一化拒绝 NaN、Infinity、负数和额外字段", () => {
    expect(
      normalize_batch_translation_progress({
        start_time: 1.5,
        time: Number.NaN,
        total_line: "4.9",
        processed_line: -2,
        total_tokens: 7,
        total_input_tokens: 3,
        total_output_tokens: 4,
        extra: 99,
        failed_line: 9,
        error_line: 1,
        line: 8,
      }),
    ).toEqual({
      start_time: 1.5,
      time: 0,
      total_line: 4,
      processed_line: 0,
      total_tokens: 7,
      total_input_tokens: 3,
      total_reasoning_tokens: 0,
      total_output_tokens: 4,
    });
  });
  it("本轮独立归一失败数，缺失与非法值归零", () => {
    for (const value of [
      undefined,
      [],
      { failed_line: -1 },
      { failed_line: Number.POSITIVE_INFINITY },
    ]) {
      expect(normalize_batch_translation_run_progress(value).failed_line).toBe(0);
    }
    expect(
      normalize_batch_translation_run_progress({ processed_line: 2, failed_line: "3.8" }),
    ).toMatchObject({ processed_line: 2, failed_line: 3 });
  });
});
