import { expect, it } from "vitest";
import { sample_batch_task_speed } from "./batch-task-waveform-state";

it("采样以当前总量为基线，只计算短窗口内的新用量", () => {
  let sample = sample_batch_task_speed(undefined, { time: 0, tokens: 400 });
  sample = sample_batch_task_speed(sample, { time: 500, tokens: 410 });
  sample = sample_batch_task_speed(sample, { time: 2_500, tokens: 450 });
  sample = sample_batch_task_speed(sample, { time: 3_000, tokens: 450 });
  expect(sample.history).toEqual([0, 20, 20, 0]);
});
