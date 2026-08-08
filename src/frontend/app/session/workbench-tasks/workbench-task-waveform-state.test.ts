import { describe, expect, it } from "vitest";

import {
  advance_task_waveform_state,
  build_task_waveform_columns,
  create_empty_task_waveform_state,
  has_unsettled_task_waveform_tail,
} from "@frontend/app/session/workbench-tasks/workbench-task-waveform-state";

describe("task waveform", () => {
  it("输出增长产生可见波形，任务结束后自然衰减直至静止", () => {
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

  it("无新输出时保留尾迹，并限制长期运行的历史长度", () => {
    let state = create_empty_task_waveform_state();

    for (let index = 0; index < 300; index += 1) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds: index * 0.5,
        total_output_tokens: index * 20,
      });
    }
    state = advance_task_waveform_state(state, {
      active: true,
      now_seconds: 150,
      total_output_tokens: 5980,
    });
    const capped_history_length = state.history.length;

    for (let index = 300; index < 400; index += 1) {
      state = advance_task_waveform_state(state, {
        active: true,
        now_seconds: index * 0.5,
        total_output_tokens: index * 20,
      });
    }

    expect(capped_history_length).toBeGreaterThan(0);
    expect(capped_history_length).toBeLessThan(300);
    expect(state.history).toHaveLength(capped_history_length);
    expect(state.history.at(-1)).toBeGreaterThan(0);
    expect(has_unsettled_task_waveform_tail(state.history)).toBe(true);
  });

  it("列高按归一样本生成，并抑制孤立尖刺", () => {
    expect(build_task_waveform_columns([0.25, 0.5, 1], 5)).toEqual([2, 3, 5]);

    const column_heights = build_task_waveform_columns([0.42, 0.44, 0.95, 0.43, 0.42], 24);
    expect(column_heights[2]).toBeLessThanOrEqual(12);
    expect(column_heights[2] - Math.max(column_heights[1], column_heights[3])).toBeLessThanOrEqual(
      3,
    );
  });
});
