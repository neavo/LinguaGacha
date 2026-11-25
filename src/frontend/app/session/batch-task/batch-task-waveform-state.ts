export const TASK_WAVEFORM_SAMPLE_INTERVAL_MS = 500;
export const TASK_WAVEFORM_VISIBLE_POINTS = 96;
const SPEED_WINDOW_MS = 2_000; // 以短窗口平滑请求集中结算造成的波动。

type SpeedObservation = Readonly<{ time: number; tokens: number }>;

export type BatchTaskSpeed = Readonly<{
  observations: readonly SpeedObservation[];
  speed: number;
  history: readonly number[];
}>;

/** 首次读数只建立基线，后续速度取窗口内新增的生成量。 */
export function sample_batch_task_speed(
  previous: BatchTaskSpeed | undefined,
  observation: SpeedObservation,
): BatchTaskSpeed {
  const observations = [
    ...(previous?.observations.filter(({ time }) => time >= observation.time - SPEED_WINDOW_MS) ??
      []),
    observation,
  ];
  const baseline = observations[0]!;
  const elapsed = (observation.time - baseline.time) / 1_000;
  const speed = elapsed > 0 ? (observation.tokens - baseline.tokens) / elapsed : 0;
  return {
    observations,
    speed,
    history: [...(previous?.history ?? []), speed].slice(-TASK_WAVEFORM_VISIBLE_POINTS),
  };
}
