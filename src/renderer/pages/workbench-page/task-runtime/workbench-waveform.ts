export const WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS = 500; // Workbench 波形只做视觉采样，不参与任务事实同步
export const WORKBENCH_WAVEFORM_VISIBLE_POINTS = 96;
const WORKBENCH_WAVEFORM_MAX_POINTS = 256;

const WORKBENCH_WAVEFORM_RATE_WINDOW_SECONDS = 2;
const WORKBENCH_WAVEFORM_MIN_RATE_WINDOW_SECONDS = 1.5;
const WORKBENCH_WAVEFORM_ATTACK_SECONDS = 0.9;
const WORKBENCH_WAVEFORM_RELEASE_SECONDS = 1.6;
const WORKBENCH_WAVEFORM_IDLE_DECAY_SECONDS = 1.1;
const WORKBENCH_WAVEFORM_SCALE_RELEASE_SECONDS = 12;
const WORKBENCH_WAVEFORM_SCALE_TARGET_RATIO = 0.72;
const WORKBENCH_WAVEFORM_MIN_ACTIVE_AMPLITUDE = 0.08;
const WORKBENCH_WAVEFORM_SPEED_ZERO_THRESHOLD = 0.05;
const WORKBENCH_WAVEFORM_AMPLITUDE_ZERO_THRESHOLD = 0.002;

type WorkbenchWaveformObservation = {
  time_seconds: number; // 最近一次采样时间，用来计算滑动窗口吞吐
  total_output_tokens: number; // 后端累计输出 token，只读事实，不承载页面派生状态
};

export type WorkbenchWaveformState = {
  history: number[]; // 已归一化到 0..1 的可绘制视觉幅度
  observations: WorkbenchWaveformObservation[]; // 只保留短窗口内的累计 token 观察值
  smoothed_speed: number; // 经过窗口吞吐和 EMA 后的视觉速度
  scale_speed: number; // 慢释放动态尺度，避免单个尖峰长期压扁后续波形
  last_sample_time_seconds: number | null; // 上一次推进状态机的时间
};

export type WorkbenchWaveformSample = {
  active: boolean; // 当前任务是否仍在运行，决定采样还是收尾衰减
  now_seconds: number; // 当前采样时间，调用方负责提供单调时间
  total_output_tokens: number; // 当前后端累计输出 token
};

// 创建空状态，供新任务、项目切换或无进度快照重置波形。
export function create_empty_workbench_waveform_state(): WorkbenchWaveformState {
  return {
    history: [],
    observations: [],
    smoothed_speed: 0,
    scale_speed: 0,
    last_sample_time_seconds: null,
  };
}

// 追加已归一化幅度，并限制历史长度防止详情面板长期打开后无界增长。
function append_workbench_waveform_amplitude(history: number[], amplitude: number): number[] {
  const normalized_amplitude = normalize_unit_value(amplitude);
  const next_history = [...history, normalized_amplitude];

  if (next_history.length > WORKBENCH_WAVEFORM_MAX_POINTS) {
    return next_history.slice(next_history.length - WORKBENCH_WAVEFORM_MAX_POINTS);
  }

  return next_history;
}

// 维护短时间观察窗口，时间倒退时丢弃旧窗口避免跨任务或系统时钟异常污染采样。
function append_workbench_waveform_observation(
  observations: WorkbenchWaveformObservation[],
  next_observation: WorkbenchWaveformObservation,
): WorkbenchWaveformObservation[] {
  const previous_observation = observations.at(-1);
  const ordered_observations =
    previous_observation === undefined ||
    next_observation.time_seconds >= previous_observation.time_seconds
      ? observations
      : [];
  const window_start_seconds =
    next_observation.time_seconds - WORKBENCH_WAVEFORM_RATE_WINDOW_SECONDS;

  return [...ordered_observations, next_observation].filter((observation) => {
    return observation.time_seconds >= window_start_seconds;
  });
}

// 将非法输入统一收口到非负数，避免 NaN 进入 canvas 绘制链路。
function normalize_non_negative_value(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// 将幅度限制在 0..1，组件只消费这个稳定视觉区间。
function normalize_unit_value(value: number): number {
  const normalized_value = normalize_non_negative_value(value);

  return Math.min(1, normalized_value);
}

// 计算两次采样间隔，首帧按默认采样周期处理以保持 EMA 手感稳定。
function resolve_elapsed_seconds(
  previous_time_seconds: number | null,
  next_time_seconds: number,
): number {
  if (previous_time_seconds === null) {
    return WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS / 1000;
  }

  return Math.max(0, next_time_seconds - previous_time_seconds);
}

// 将真实时间间隔转换为 EMA 系数，使波形在不同采样间隔下保持相近手感。
function resolve_time_alpha(elapsed_seconds: number, time_constant_seconds: number): number {
  if (elapsed_seconds <= 0 || time_constant_seconds <= 0) {
    return 1;
  }

  return 1 - Math.exp(-elapsed_seconds / time_constant_seconds);
}

// 按时间常数靠近目标值，用于活跃期的速度平滑。
function smooth_workbench_waveform_value(args: {
  previous_value: number;
  target_value: number;
  elapsed_seconds: number;
  time_constant_seconds: number;
}): number {
  const alpha = resolve_time_alpha(args.elapsed_seconds, args.time_constant_seconds);

  return args.previous_value + (args.target_value - args.previous_value) * alpha;
}

// 按指数曲线衰减，并在足够小时归零，避免不可见小数让动画永远运行。
function decay_workbench_waveform_value(args: {
  previous_value: number;
  elapsed_seconds: number;
  time_constant_seconds: number;
}): number {
  const next_value =
    args.previous_value * Math.exp(-args.elapsed_seconds / args.time_constant_seconds);

  return next_value <= WORKBENCH_WAVEFORM_SPEED_ZERO_THRESHOLD ? 0 : next_value;
}

// 用累计输出 token 的短窗口差值估计吞吐，避免单个 SSE 间隔决定整帧高度。
function resolve_window_output_speed(observations: WorkbenchWaveformObservation[]): number {
  const first_observation = observations[0];
  const last_observation = observations.at(-1);
  if (first_observation === undefined || last_observation === undefined) {
    return 0;
  }

  const output_token_delta = Math.max(
    0,
    last_observation.total_output_tokens - first_observation.total_output_tokens,
  );
  const elapsed_seconds = Math.max(
    WORKBENCH_WAVEFORM_MIN_RATE_WINDOW_SECONDS,
    last_observation.time_seconds - first_observation.time_seconds,
  );

  return output_token_delta / elapsed_seconds;
}

// 维护慢释放动态尺度，让尖峰不过度拉满，同时让后续低中速仍然可见。
function resolve_workbench_waveform_scale(args: {
  previous_scale: number;
  smoothed_speed: number;
  elapsed_seconds: number;
}): number {
  const released_scale = decay_workbench_waveform_value({
    previous_value: args.previous_scale,
    elapsed_seconds: args.elapsed_seconds,
    time_constant_seconds: WORKBENCH_WAVEFORM_SCALE_RELEASE_SECONDS,
  });
  const target_scale =
    args.smoothed_speed <= 0 ? 0 : args.smoothed_speed / WORKBENCH_WAVEFORM_SCALE_TARGET_RATIO;

  return Math.max(released_scale, target_scale);
}

// 将平滑速度映射成最终视觉幅度，低中速用曲线放大，尖峰用动态尺度压回可读范围。
function resolve_workbench_waveform_amplitude(args: {
  active: boolean;
  scale_speed: number;
  smoothed_speed: number;
}): number {
  if (
    args.scale_speed <= WORKBENCH_WAVEFORM_SPEED_ZERO_THRESHOLD ||
    args.smoothed_speed <= WORKBENCH_WAVEFORM_SPEED_ZERO_THRESHOLD
  ) {
    return 0;
  }

  // 为什么：平方根曲线保留中低速层次，同时把短促尖峰压回可读范围。
  const curved_amplitude = Math.sqrt(
    Math.min(1, Math.max(0, args.smoothed_speed / args.scale_speed)),
  );
  if (curved_amplitude <= WORKBENCH_WAVEFORM_AMPLITUDE_ZERO_THRESHOLD) {
    return 0;
  }

  if (args.active) {
    return Math.max(WORKBENCH_WAVEFORM_MIN_ACTIVE_AMPLITUDE, curved_amplitude);
  }

  return curved_amplitude;
}

// 推进波形状态机：活跃期采样累计 token，非活跃期只推进衰减尾巴。
export function advance_workbench_waveform_state(
  state: WorkbenchWaveformState,
  sample: WorkbenchWaveformSample,
): WorkbenchWaveformState {
  const now_seconds = Number.isFinite(sample.now_seconds)
    ? sample.now_seconds
    : (state.last_sample_time_seconds ?? 0) + WORKBENCH_WAVEFORM_SAMPLE_INTERVAL_MS / 1000;
  const elapsed_seconds = resolve_elapsed_seconds(state.last_sample_time_seconds, now_seconds);

  if (!sample.active) {
    const next_smoothed_speed = decay_workbench_waveform_value({
      previous_value: state.smoothed_speed,
      elapsed_seconds,
      time_constant_seconds: WORKBENCH_WAVEFORM_IDLE_DECAY_SECONDS,
    });
    const next_scale_speed = resolve_workbench_waveform_scale({
      previous_scale: state.scale_speed,
      smoothed_speed: next_smoothed_speed,
      elapsed_seconds,
    });
    const next_amplitude = resolve_workbench_waveform_amplitude({
      active: false,
      scale_speed: next_scale_speed,
      smoothed_speed: next_smoothed_speed,
    });

    return {
      history: append_workbench_waveform_amplitude(state.history, next_amplitude),
      observations: [],
      smoothed_speed: next_smoothed_speed,
      scale_speed: next_scale_speed,
      last_sample_time_seconds: now_seconds,
    };
  }

  const next_observations = append_workbench_waveform_observation(state.observations, {
    time_seconds: now_seconds,
    total_output_tokens: normalize_non_negative_value(sample.total_output_tokens),
  });
  const window_output_speed = resolve_window_output_speed(next_observations);
  const smoothing_seconds =
    window_output_speed >= state.smoothed_speed
      ? WORKBENCH_WAVEFORM_ATTACK_SECONDS
      : WORKBENCH_WAVEFORM_RELEASE_SECONDS;
  const next_smoothed_speed = smooth_workbench_waveform_value({
    previous_value: state.smoothed_speed,
    target_value: window_output_speed,
    elapsed_seconds,
    time_constant_seconds: smoothing_seconds,
  });
  const next_scale_speed = resolve_workbench_waveform_scale({
    previous_scale: state.scale_speed,
    smoothed_speed: next_smoothed_speed,
    elapsed_seconds,
  });
  const next_amplitude = resolve_workbench_waveform_amplitude({
    active: true,
    scale_speed: next_scale_speed,
    smoothed_speed: next_smoothed_speed,
  });

  return {
    history: append_workbench_waveform_amplitude(state.history, next_amplitude),
    observations: next_observations,
    smoothed_speed: next_smoothed_speed,
    scale_speed: next_scale_speed,
    last_sample_time_seconds: now_seconds,
  };
}

// 将 0..1 幅度转换成 canvas 绘制列高，保持组件只关心像素绘制。
export function build_workbench_waveform_columns(history: number[], row_count: number): number[] {
  const normalized_row_count = Math.max(1, Math.floor(normalize_non_negative_value(row_count)));
  const visible_history =
    history.length >= WORKBENCH_WAVEFORM_VISIBLE_POINTS
      ? history.slice(history.length - WORKBENCH_WAVEFORM_VISIBLE_POINTS)
      : history;

  return visible_history.map((amplitude) => {
    return Math.floor(normalize_unit_value(amplitude) * (normalized_row_count - 1) + 1);
  });
}

// 只检查可见窗口是否还有非零幅度，用来决定收尾动画是否继续运行。
export function has_unsettled_workbench_waveform_tail(history: number[]): boolean {
  const visible_history =
    history.length <= WORKBENCH_WAVEFORM_VISIBLE_POINTS
      ? history
      : history.slice(history.length - WORKBENCH_WAVEFORM_VISIBLE_POINTS);

  return visible_history.some(
    (amplitude) => amplitude > WORKBENCH_WAVEFORM_AMPLITUDE_ZERO_THRESHOLD,
  );
}
