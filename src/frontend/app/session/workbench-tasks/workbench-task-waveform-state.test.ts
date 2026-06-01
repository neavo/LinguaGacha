import { describe, expect, it } from "vitest";

import {
  advance_task_waveform_state,
  build_task_waveform_columns,
  create_empty_task_waveform_state,
  has_unsettled_task_waveform_tail,
  TASK_WAVEFORM_SAMPLE_INTERVAL_MS,
} from "@frontend/app/session/workbench-tasks/workbench-task-waveform-state";

describe("task-waveform", () => {
  it("使用与任务运行态一致的 500ms 表现层采样节奏", () => {
    expect(TASK_WAVEFORM_SAMPLE_INTERVAL_MS).toBe(500);
  });

  it("把短时输出突发平滑成可读波形，并在空帧中保持自然回落", () => {
    let state = create_empty_task_waveform_state();

    state = advance_task_waveform_state(state, {
      active: true,
      now_seconds: 0,
      total_output_tokens: 0,
    });
    state = advance_task_waveform_state(state, {
      active: true,
      now_seconds: 0.5,
      total_output_tokens: 120,
    });
    const burst_sample = state.history.at(-1) ?? 0;

    state = advance_task_waveform_state(state, {
      active: true,
      now_seconds: 1,
      total_output_tokens: 120,
    });
    const empty_frame_sample = state.history.at(-1) ?? 0;

    expect(burst_sample).toBeGreaterThan(0);
    expect(burst_sample).toBeLessThan(0.95);
    expect(empty_frame_sample).toBeGreaterThan(0);
    expect(Math.abs(empty_frame_sample - burst_sample)).toBeLessThan(0.25);
  });

  it("只用累计输出 token 推进活跃波形，非输出进度变化不会制造 0 样本", () => {
    let state = create_empty_task_waveform_state();

    for (const [now_seconds, total_output_tokens] of [
      [0, 0],
      [0.5, 60],
      [1, 120],
      [1.5, 120],
      [2, 120],
    ] as const) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds,
        total_output_tokens,
      });
    }

    expect(state.history.at(-1)).toBeGreaterThan(0);
    expect(has_unsettled_task_waveform_tail(state.history)).toBe(true);
  });

  it("速度持续爬坡时保留可见起伏，不把波形压成贴顶平线", () => {
    let state = create_empty_task_waveform_state();
    let total_output_tokens = 0;

    for (let index = 0; index < 16; index += 1) {
      total_output_tokens += index * 18;
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds: index * 0.5,
        total_output_tokens,
      });
    }

    const visible_samples = state.history.slice(-8);
    const sample_ceiling = Math.max(...visible_samples);
    const sample_floor = Math.min(...visible_samples);
    const rounded_visible_sample_count = new Set(
      visible_samples.map((sample) => Math.round(sample * 100)),
    ).size;

    expect(sample_ceiling).toBeLessThan(0.92);
    expect(sample_ceiling - sample_floor).toBeGreaterThan(0.12);
    expect(rounded_visible_sample_count).toBeGreaterThanOrEqual(4);
  });

  it("速度骤降时逐帧释放视觉尾迹，不在右侧突然铺成平底", () => {
    let state = create_empty_task_waveform_state();

    for (const [now_seconds, total_output_tokens] of [
      [0, 0],
      [0.5, 140],
      [1, 280],
      [1.5, 420],
      [2, 420],
      [2.5, 420],
      [3, 420],
    ] as const) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds,
        total_output_tokens,
      });
    }

    const release_samples = state.history.slice(-4);
    const max_adjacent_fall = Math.max(
      ...release_samples.slice(1).map((sample, index) => release_samples[index] - sample),
    );

    expect(release_samples.at(-1)).toBeGreaterThan(0);
    expect(max_adjacent_fall).toBeLessThanOrEqual(0.14);
  });

  it("任务结束后保留衰减尾巴，并在可见窗口扫空后停止动画", () => {
    let state = create_empty_task_waveform_state();

    for (const [now_seconds, total_output_tokens] of [
      [0, 0],
      [0.5, 80],
      [1, 160],
    ] as const) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds,
        total_output_tokens,
      });
    }

    state = advance_task_waveform_state(state, {
      active: false,
      now_seconds: 1.5,
      total_output_tokens: 160,
    });
    expect(state.history.at(-1)).toBeGreaterThan(0);

    for (let index = 0; index < 120; index += 1) {
      state = advance_task_waveform_state(state, {
        active: false,
        now_seconds: 2 + index * 0.5,
        total_output_tokens: 160,
      });
    }

    expect(state.history.at(-1)).toBe(0);
    expect(has_unsettled_task_waveform_tail(state.history)).toBe(false);
  });

  it("任务结束后的尾巴保持连续衰减，不立刻切成平线", () => {
    let state = create_empty_task_waveform_state();

    for (const [now_seconds, total_output_tokens, active] of [
      [0, 0, true],
      [0.5, 120, true],
      [1, 240, true],
      [1.5, 360, true],
      [2, 360, false],
      [2.5, 360, false],
      [3, 360, false],
    ] as const) {
      state = advance_task_waveform_state(state, {
        active,
        now_seconds,
        total_output_tokens,
      });
    }

    const ending_samples = state.history.slice(-4);
    const max_adjacent_fall = Math.max(
      ...ending_samples.slice(1).map((sample, index) => ending_samples[index] - sample),
    );

    expect(ending_samples.at(-1)).toBeGreaterThan(0);
    expect(max_adjacent_fall).toBeLessThanOrEqual(0.07);
  });

  it("限制历史长度，避免详情面板长期打开时累积无界数据", () => {
    let state = create_empty_task_waveform_state();

    for (let index = 0; index < 300; index += 1) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds: index * 0.5,
        total_output_tokens: index * 20,
      });
    }

    expect(state.history).toHaveLength(256);
  });

  it("按已归一化视觉样本生成列高，不再用可见窗口 min-max 强行拉满", () => {
    expect(build_task_waveform_columns([0.25, 0.5, 1], 5)).toEqual([2, 3, 5]);
  });

  it("生成列高时只削弱孤立尖刺，让单根高柱变成连续峰丘", () => {
    const column_heights = build_task_waveform_columns([0.42, 0.44, 0.95, 0.43, 0.42], 24);

    expect(column_heights[2]).toBeLessThanOrEqual(12);
    expect(column_heights[2] - Math.max(column_heights[1], column_heights[3])).toBeLessThanOrEqual(
      3,
    );
  });
});
