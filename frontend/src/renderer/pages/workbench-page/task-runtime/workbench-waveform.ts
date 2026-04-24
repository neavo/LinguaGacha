export const WORKBENCH_WAVEFORM_VISIBLE_POINTS = 96;
const WORKBENCH_WAVEFORM_MAX_POINTS = 256;

const WORKBENCH_WAVEFORM_IDLE_DECAY_RATIO = 0.78;
const WORKBENCH_WAVEFORM_ZERO_THRESHOLD = 1;

export function append_workbench_waveform_sample(history: number[], sample: number): number[] {
  const normalized_sample = Number.isFinite(sample) ? Math.max(0, sample) : 0;
  const next_history = [...history, normalized_sample];

  if (next_history.length > WORKBENCH_WAVEFORM_MAX_POINTS) {
    return next_history.slice(next_history.length - WORKBENCH_WAVEFORM_MAX_POINTS);
  }

  return next_history;
}

export function decay_workbench_waveform_sample(sample: number): number {
  const normalized_sample = Number.isFinite(sample) ? Math.max(0, sample) : 0;

  // 为什么：波形收尾需要“看得见地回落”，而不是瞬间清空，所以空闲态按固定比例衰减。
  if (normalized_sample <= WORKBENCH_WAVEFORM_ZERO_THRESHOLD) {
    return 0;
  }

  return normalized_sample * WORKBENCH_WAVEFORM_IDLE_DECAY_RATIO;
}

export function has_unsettled_workbench_waveform_tail(history: number[]): boolean {
  const visible_history =
    history.length <= WORKBENCH_WAVEFORM_VISIBLE_POINTS
      ? history
      : history.slice(history.length - WORKBENCH_WAVEFORM_VISIBLE_POINTS);

  return visible_history.some((sample) => sample > 0);
}
