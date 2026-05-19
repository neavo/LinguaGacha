import { describe, expect, it } from "vitest";

import {
  advance_workbench_waveform_state,
  build_workbench_waveform_columns,
  create_empty_workbench_waveform_state,
  has_unsettled_workbench_waveform_tail,
  WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@/pages/workbench-page/task-runtime/workbench-waveform";

describe("workbench-waveform", () => {
  it("使用与任务运行态一致的 500ms 表现层采样节奏", () => {
    expect(WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS).toBe(500);
  });

  it("把短时输出突发平滑成可读波形，并在空帧中保持自然回落", () => {
    let state = create_empty_workbench_waveform_state();

    state = advance_workbench_waveform_state(state, {
      active: true,
      now_seconds: 0,
      total_output_tokens: 0,
    });
    state = advance_workbench_waveform_state(state, {
      active: true,
      now_seconds: 0.5,
      total_output_tokens: 120,
    });
    const burst_amplitude = state.history.at(-1) ?? 0;

    state = advance_workbench_waveform_state(state, {
      active: true,
      now_seconds: 1,
      total_output_tokens: 120,
    });
    const empty_frame_amplitude = state.history.at(-1) ?? 0;

    expect(burst_amplitude).toBeGreaterThan(0);
    expect(burst_amplitude).toBeLessThan(0.95);
    expect(empty_frame_amplitude).toBeGreaterThan(0);
    expect(Math.abs(empty_frame_amplitude - burst_amplitude)).toBeLessThan(0.25);
  });

  it("只用累计输出 token 推进活跃波形，非输出进度变化不会制造 0 样本", () => {
    let state = create_empty_workbench_waveform_state();

    for (const [now_seconds, total_output_tokens] of [
      [0, 0],
      [0.5, 60],
      [1, 120],
      [1.5, 120],
      [2, 120],
    ] as const) {
      state = advance_workbench_waveform_state(state, {
        active: true,
        now_seconds,
        total_output_tokens,
      });
    }

    expect(state.history.at(-1)).toBeGreaterThan(0);
    expect(has_unsettled_workbench_waveform_tail(state.history)).toBe(true);
  });

  it("任务结束后保留衰减尾巴，并在可见窗口扫空后停止动画", () => {
    let state = create_empty_workbench_waveform_state();

    for (const [now_seconds, total_output_tokens] of [
      [0, 0],
      [0.5, 80],
      [1, 160],
    ] as const) {
      state = advance_workbench_waveform_state(state, {
        active: true,
        now_seconds,
        total_output_tokens,
      });
    }

    state = advance_workbench_waveform_state(state, {
      active: false,
      now_seconds: 1.5,
      total_output_tokens: 160,
    });
    expect(state.history.at(-1)).toBeGreaterThan(0);

    for (let index = 0; index < 120; index += 1) {
      state = advance_workbench_waveform_state(state, {
        active: false,
        now_seconds: 2 + index * 0.5,
        total_output_tokens: 160,
      });
    }

    expect(state.history.at(-1)).toBe(0);
    expect(has_unsettled_workbench_waveform_tail(state.history)).toBe(false);
  });

  it("限制历史长度，避免详情面板长期打开时累积无界数据", () => {
    let state = create_empty_workbench_waveform_state();

    for (let index = 0; index < 300; index += 1) {
      state = advance_workbench_waveform_state(state, {
        active: true,
        now_seconds: index * 0.5,
        total_output_tokens: index * 20,
      });
    }

    expect(state.history).toHaveLength(256);
  });

  it("按已归一化幅度生成列高，不再用可见窗口 min-max 强行拉满", () => {
    expect(build_workbench_waveform_columns([0.25, 0.5, 1], 5)).toEqual([2, 3, 5]);
  });
});
