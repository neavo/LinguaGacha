export const TASK_WAVEFORM_SAMPLE_INTERVAL_MS = 500; // 任务波形只做视觉采样，不参与任务事实同步
export const TASK_WAVEFORM_VISIBLE_POINTS = 96;
const TASK_WAVEFORM_MAX_POINTS = 256;

// 速度估计参数：短窗口负责吞吐稳定性，attack / release 负责视觉响应手感。
const TASK_WAVEFORM_RATE_WINDOW_SECONDS = 2;
const TASK_WAVEFORM_MIN_RATE_WINDOW_SECONDS = 1.5;
const TASK_WAVEFORM_ATTACK_SECONDS = 0.9;
const TASK_WAVEFORM_RELEASE_SECONDS = 1.6;
const TASK_WAVEFORM_IDLE_DECAY_SECONDS = 1.1;

// 参照速度参数：参照速度慢于当前速度变化，避免爬坡期被重标定成同一高度。
const TASK_WAVEFORM_REFERENCE_ATTACK_SECONDS = 5.5;
const TASK_WAVEFORM_REFERENCE_RELEASE_SECONDS = 16;
const TASK_WAVEFORM_REFERENCE_INITIAL_LEVEL = 0.32;
const TASK_WAVEFORM_REFERENCE_TARGET_LEVEL = 0.68;
const TASK_WAVEFORM_MAX_SPEED_LEVEL = 0.86;
const TASK_WAVEFORM_MIN_ACTIVE_SPEED_LEVEL = 0.12;

// 趋势与载波参数：速度水平控制能量，趋势控制方向，载波保证持续起伏。
const TASK_WAVEFORM_TREND_SECONDS = 0.8;
const TASK_WAVEFORM_CARRIER_BASE_HZ = 0.72;
const TASK_WAVEFORM_CARRIER_SPEED_HZ = 0.58;
const TASK_WAVEFORM_CARRIER_TREND_HZ = 0.18;

// 视觉合成参数：baseline 与 radius 永远给上下边界留余量，避免贴顶贴底。
const TASK_WAVEFORM_BASELINE_MIN = 0.2;
const TASK_WAVEFORM_BASELINE_RANGE = 0.46;
const TASK_WAVEFORM_WAVE_RADIUS_MIN = 0.055;
const TASK_WAVEFORM_WAVE_RADIUS_RANGE = 0.17;
const TASK_WAVEFORM_TREND_BIAS_LIMIT = 0.08;
const TASK_WAVEFORM_TREND_RADIUS_BONUS = 0.055;
const TASK_WAVEFORM_BOTTOM_HEADROOM = 0.04;
const TASK_WAVEFORM_TOP_HEADROOM = 0.1;
const TASK_WAVEFORM_FULL_TURN = Math.PI * 2;
const TASK_WAVEFORM_SPEED_ZERO_THRESHOLD = 0.05;
const TASK_WAVEFORM_SAMPLE_ZERO_THRESHOLD = 0.002;
const TASK_WAVEFORM_ACTIVE_RISE_LIMIT = 0.18;
const TASK_WAVEFORM_ACTIVE_FALL_LIMIT = 0.13;
const TASK_WAVEFORM_IDLE_RISE_LIMIT = 0.08;
const TASK_WAVEFORM_IDLE_FALL_LIMIT = 0.06;
const TASK_WAVEFORM_DISPLAY_SPIKE_LIMIT = 0.08;

type WorkbenchTaskWaveformObservation = {
  time_seconds: number; // 最近一次采样时间，用来计算滑动窗口吞吐
  total_output_tokens: number; // 后端累计输出 token，只读事实，不承载页面计算状态
};

export type WorkbenchTaskWaveformState = {
  history: number[]; // 已归一化到 0..1 的可绘制视觉样本，值已预留上下边界余量
  observations: WorkbenchTaskWaveformObservation[]; // 只保留短窗口内的累计 token 观察值
  smoothed_speed: number; // 经过窗口吞吐和 EMA 后的视觉速度
  reference_speed: number; // 慢变速度参照，用来判断当前速度水平而不直接拉满高度
  trend_level: number; // -1..1 的加速 / 减速趋势，负责表达爬坡和回落方向
  carrier_phase: number; // 连续载波相位，保证速度上升或下降时仍然有可见起伏
  last_sample_time_seconds: number | null; // 上一次推进状态机的时间
};

export type WorkbenchTaskWaveformSample = {
  active: boolean; // 当前任务是否仍在运行，决定采样还是收尾衰减
  now_seconds: number; // 当前采样时间，调用方负责提供单调时间
  total_output_tokens: number; // 当前后端累计输出 token
};

// 创建空状态，供新任务、项目切换或无进度快照重置波形。
export function create_empty_task_waveform_state(): WorkbenchTaskWaveformState {
  return {
    history: [],
    observations: [],
    smoothed_speed: 0,
    reference_speed: 0,
    trend_level: 0,
    carrier_phase: 0,
    last_sample_time_seconds: null,
  };
}

// 对单帧跳变做视觉限速，避免采样命中波峰或任务结束时把曲线切成尖刺和平底。
function resolve_task_waveform_temporal_sample(args: {
  active: boolean;
  history: number[];
  sample: number;
}): number {
  const normalized_sample = normalize_unit_value(args.sample);
  const previous_sample = args.history.at(-1);
  if (previous_sample === undefined) {
    return normalized_sample;
  }

  const rise_limit = args.active ? TASK_WAVEFORM_ACTIVE_RISE_LIMIT : TASK_WAVEFORM_IDLE_RISE_LIMIT;
  const fall_limit = args.active ? TASK_WAVEFORM_ACTIVE_FALL_LIMIT : TASK_WAVEFORM_IDLE_FALL_LIMIT;
  if (normalized_sample > previous_sample + rise_limit) {
    return previous_sample + rise_limit;
  }
  if (normalized_sample < previous_sample - fall_limit) {
    const released_sample = previous_sample - fall_limit;

    return released_sample <= TASK_WAVEFORM_SAMPLE_ZERO_THRESHOLD ? 0 : released_sample;
  }

  return normalized_sample;
}

// 追加已归一化视觉样本，并限制历史长度防止详情面板长期打开后无界增长。
function append_task_waveform_sample(args: {
  active: boolean;
  history: number[];
  sample: number;
}): number[] {
  const normalized_sample = resolve_task_waveform_temporal_sample(args);
  const next_history = [...args.history, normalized_sample];

  if (next_history.length > TASK_WAVEFORM_MAX_POINTS) {
    return next_history.slice(next_history.length - TASK_WAVEFORM_MAX_POINTS);
  }

  return next_history;
}

// 维护短时间观察窗口，时间倒退时丢弃旧窗口避免跨任务或系统时钟异常污染采样。
function append_task_waveform_observation(
  observations: WorkbenchTaskWaveformObservation[],
  next_observation: WorkbenchTaskWaveformObservation,
): WorkbenchTaskWaveformObservation[] {
  const previous_observation = observations.at(-1);
  const ordered_observations =
    previous_observation === undefined ||
    next_observation.time_seconds >= previous_observation.time_seconds
      ? observations
      : [];
  const window_start_seconds = next_observation.time_seconds - TASK_WAVEFORM_RATE_WINDOW_SECONDS;

  return [...ordered_observations, next_observation].filter((observation) => {
    return observation.time_seconds >= window_start_seconds;
  });
}

// 将非法输入统一收口到非负数，避免 NaN 进入 canvas 绘制链路。
function normalize_non_negative_value(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// 将视觉样本限制在 0..1，组件只消费这个稳定绘制区间。
function normalize_unit_value(value: number): number {
  const normalized_value = normalize_non_negative_value(value);

  return Math.min(1, normalized_value);
}

// 将趋势类信号限制在 -1..1，避免异常采样间隔把方向性放大成绘制尖峰。
function normalize_signed_unit_value(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(-1, value));
}

// 计算两次采样间隔，首帧按默认采样周期处理以保持 EMA 手感稳定。
function resolve_elapsed_seconds(
  previous_time_seconds: number | null,
  next_time_seconds: number,
): number {
  if (previous_time_seconds === null) {
    return TASK_WAVEFORM_SAMPLE_INTERVAL_MS / 1000;
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
function smooth_task_waveform_value(args: {
  previous_value: number;
  target_value: number;
  elapsed_seconds: number;
  time_constant_seconds: number;
}): number {
  const alpha = resolve_time_alpha(args.elapsed_seconds, args.time_constant_seconds);

  return args.previous_value + (args.target_value - args.previous_value) * alpha;
}

// 按指数曲线衰减，并在足够小时归零，避免不可见小数让动画永远运行。
function decay_task_waveform_value(args: {
  previous_value: number;
  elapsed_seconds: number;
  time_constant_seconds: number;
}): number {
  const next_value =
    args.previous_value * Math.exp(-args.elapsed_seconds / args.time_constant_seconds);

  return next_value <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD ? 0 : next_value;
}

// 视觉层级使用轻微开方，让低中速不至于贴在底部，但仍保留高速余量。
function ease_task_waveform_level(speed_level: number): number {
  const normalized_level = Math.min(1, Math.max(0, speed_level / TASK_WAVEFORM_MAX_SPEED_LEVEL));

  return Math.sqrt(normalized_level);
}

// 用累计输出 token 的短窗口差值估计吞吐，避免单个 SSE 间隔决定整帧高度。
function resolve_window_output_speed(observations: WorkbenchTaskWaveformObservation[]): number {
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
    TASK_WAVEFORM_MIN_RATE_WINDOW_SECONDS,
    last_observation.time_seconds - first_observation.time_seconds,
  );

  return output_token_delta / elapsed_seconds;
}

// 维护慢变参照速度：首个信号从低位进入，持续高吞吐再慢慢重标定。
function resolve_task_waveform_reference_speed(args: {
  previous_reference_speed: number;
  smoothed_speed: number;
  elapsed_seconds: number;
}): number {
  const previous_reference_speed = normalize_non_negative_value(args.previous_reference_speed);
  const smoothed_speed = normalize_non_negative_value(args.smoothed_speed);

  if (
    previous_reference_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD &&
    smoothed_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD
  ) {
    return 0;
  }

  if (previous_reference_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD) {
    return smoothed_speed / TASK_WAVEFORM_REFERENCE_INITIAL_LEVEL;
  }

  const target_reference_speed =
    smoothed_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD
      ? 0
      : smoothed_speed / TASK_WAVEFORM_REFERENCE_TARGET_LEVEL;
  const time_constant_seconds =
    target_reference_speed > previous_reference_speed
      ? TASK_WAVEFORM_REFERENCE_ATTACK_SECONDS
      : TASK_WAVEFORM_REFERENCE_RELEASE_SECONDS;
  const next_reference_speed = smooth_task_waveform_value({
    previous_value: previous_reference_speed,
    target_value: target_reference_speed,
    elapsed_seconds: args.elapsed_seconds,
    time_constant_seconds,
  });
  const minimum_reference_speed =
    smoothed_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD
      ? 0
      : smoothed_speed / TASK_WAVEFORM_MAX_SPEED_LEVEL;

  return Math.max(minimum_reference_speed, next_reference_speed);
}

// 把平滑速度映射成 0..1 水平；最大水平低于 1，给载波和趋势预留空间。
function resolve_task_waveform_speed_level(args: {
  reference_speed: number;
  smoothed_speed: number;
}): number {
  if (
    args.reference_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD ||
    args.smoothed_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD
  ) {
    return 0;
  }

  return Math.min(
    TASK_WAVEFORM_MAX_SPEED_LEVEL,
    Math.max(0, args.smoothed_speed / args.reference_speed),
  );
}

// 把相邻平滑速度差转成方向性信号，正值表示爬坡，负值表示回落。
function resolve_task_waveform_trend_level(args: {
  previous_smoothed_speed: number;
  next_smoothed_speed: number;
  previous_trend_level: number;
  reference_speed: number;
  elapsed_seconds: number;
}): number {
  if (args.reference_speed <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD) {
    return 0;
  }

  const speed_delta = args.next_smoothed_speed - args.previous_smoothed_speed;
  const trend_target = normalize_signed_unit_value(
    speed_delta / Math.max(args.reference_speed * 0.18, TASK_WAVEFORM_SPEED_ZERO_THRESHOLD),
  );
  const next_trend_level = smooth_task_waveform_value({
    previous_value: args.previous_trend_level,
    target_value: trend_target,
    elapsed_seconds: args.elapsed_seconds,
    time_constant_seconds: TASK_WAVEFORM_TREND_SECONDS,
  });

  return Math.abs(next_trend_level) <= TASK_WAVEFORM_SAMPLE_ZERO_THRESHOLD
    ? 0
    : normalize_signed_unit_value(next_trend_level);
}

// 根据速度水平和趋势推进载波，让历史样本形成真正的波而不是速度高度线。
function advance_task_waveform_carrier_phase(args: {
  previous_phase: number;
  speed_level: number;
  trend_level: number;
  elapsed_seconds: number;
}): number {
  if (
    args.speed_level <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD &&
    Math.abs(args.trend_level) <= TASK_WAVEFORM_SAMPLE_ZERO_THRESHOLD
  ) {
    return args.previous_phase;
  }

  const carrier_frequency_hz =
    TASK_WAVEFORM_CARRIER_BASE_HZ +
    TASK_WAVEFORM_CARRIER_SPEED_HZ * args.speed_level +
    TASK_WAVEFORM_CARRIER_TREND_HZ * Math.abs(args.trend_level);
  const next_phase =
    args.previous_phase +
    carrier_frequency_hz * Math.max(0, args.elapsed_seconds) * TASK_WAVEFORM_FULL_TURN;

  return next_phase % TASK_WAVEFORM_FULL_TURN;
}

// 合成最终视觉样本：速度给能量，趋势给方向，载波负责始终可见的起伏。
function resolve_task_waveform_visual_sample(args: {
  active: boolean;
  speed_level: number;
  trend_level: number;
  carrier_phase: number;
}): number {
  if (args.speed_level <= TASK_WAVEFORM_SPEED_ZERO_THRESHOLD) {
    return 0;
  }

  const visible_speed_level = args.active
    ? Math.max(args.speed_level, TASK_WAVEFORM_MIN_ACTIVE_SPEED_LEVEL)
    : args.speed_level;
  const eased_level = ease_task_waveform_level(visible_speed_level);
  const baseline =
    TASK_WAVEFORM_BASELINE_MIN +
    TASK_WAVEFORM_BASELINE_RANGE * eased_level +
    args.trend_level * TASK_WAVEFORM_TREND_BIAS_LIMIT;
  const bounded_baseline = Math.min(
    1 - TASK_WAVEFORM_TOP_HEADROOM,
    Math.max(TASK_WAVEFORM_BOTTOM_HEADROOM, baseline),
  );
  const wave_radius =
    TASK_WAVEFORM_WAVE_RADIUS_MIN +
    TASK_WAVEFORM_WAVE_RADIUS_RANGE * eased_level +
    Math.abs(args.trend_level) * TASK_WAVEFORM_TREND_RADIUS_BONUS;
  const safe_wave_radius = Math.min(
    wave_radius,
    Math.max(
      0,
      Math.min(
        bounded_baseline - TASK_WAVEFORM_BOTTOM_HEADROOM,
        1 - TASK_WAVEFORM_TOP_HEADROOM - bounded_baseline,
      ),
    ),
  );

  return normalize_unit_value(bounded_baseline + Math.sin(args.carrier_phase) * safe_wave_radius);
}

// 推进波形状态机：活跃期采样累计 token，非活跃期只推进衰减尾巴。
export function advance_task_waveform_state(
  state: WorkbenchTaskWaveformState,
  sample: WorkbenchTaskWaveformSample,
): WorkbenchTaskWaveformState {
  const now_seconds = Number.isFinite(sample.now_seconds)
    ? sample.now_seconds
    : (state.last_sample_time_seconds ?? 0) + TASK_WAVEFORM_SAMPLE_INTERVAL_MS / 1000;
  const elapsed_seconds = resolve_elapsed_seconds(state.last_sample_time_seconds, now_seconds);

  if (!sample.active) {
    const next_smoothed_speed = decay_task_waveform_value({
      previous_value: state.smoothed_speed,
      elapsed_seconds,
      time_constant_seconds: TASK_WAVEFORM_IDLE_DECAY_SECONDS,
    });
    const next_reference_speed = resolve_task_waveform_reference_speed({
      previous_reference_speed: state.reference_speed,
      smoothed_speed: next_smoothed_speed,
      elapsed_seconds,
    });
    const next_speed_level = resolve_task_waveform_speed_level({
      reference_speed: next_reference_speed,
      smoothed_speed: next_smoothed_speed,
    });
    const next_trend_level = resolve_task_waveform_trend_level({
      previous_smoothed_speed: state.smoothed_speed,
      next_smoothed_speed,
      previous_trend_level: state.trend_level,
      reference_speed: next_reference_speed,
      elapsed_seconds,
    });
    const next_carrier_phase = advance_task_waveform_carrier_phase({
      previous_phase: state.carrier_phase,
      speed_level: next_speed_level,
      trend_level: next_trend_level,
      elapsed_seconds,
    });
    const next_visual_sample = resolve_task_waveform_visual_sample({
      active: false,
      speed_level: next_speed_level,
      trend_level: next_trend_level,
      carrier_phase: next_carrier_phase,
    });

    return {
      history: append_task_waveform_sample({
        active: false,
        history: state.history,
        sample: next_visual_sample,
      }),
      observations: [],
      smoothed_speed: next_smoothed_speed,
      reference_speed: next_reference_speed,
      trend_level: next_trend_level,
      carrier_phase: next_carrier_phase,
      last_sample_time_seconds: now_seconds,
    };
  }

  const next_observations = append_task_waveform_observation(state.observations, {
    time_seconds: now_seconds,
    total_output_tokens: normalize_non_negative_value(sample.total_output_tokens),
  });
  const window_output_speed = resolve_window_output_speed(next_observations);
  const smoothing_seconds =
    window_output_speed >= state.smoothed_speed
      ? TASK_WAVEFORM_ATTACK_SECONDS
      : TASK_WAVEFORM_RELEASE_SECONDS;
  const next_smoothed_speed = smooth_task_waveform_value({
    previous_value: state.smoothed_speed,
    target_value: window_output_speed,
    elapsed_seconds,
    time_constant_seconds: smoothing_seconds,
  });
  const next_reference_speed = resolve_task_waveform_reference_speed({
    previous_reference_speed: state.reference_speed,
    smoothed_speed: next_smoothed_speed,
    elapsed_seconds,
  });
  const next_speed_level = resolve_task_waveform_speed_level({
    reference_speed: next_reference_speed,
    smoothed_speed: next_smoothed_speed,
  });
  const next_trend_level = resolve_task_waveform_trend_level({
    previous_smoothed_speed: state.smoothed_speed,
    next_smoothed_speed,
    previous_trend_level: state.trend_level,
    reference_speed: next_reference_speed,
    elapsed_seconds,
  });
  const next_carrier_phase = advance_task_waveform_carrier_phase({
    previous_phase: state.carrier_phase,
    speed_level: next_speed_level,
    trend_level: next_trend_level,
    elapsed_seconds,
  });
  const next_visual_sample = resolve_task_waveform_visual_sample({
    active: true,
    speed_level: next_speed_level,
    trend_level: next_trend_level,
    carrier_phase: next_carrier_phase,
  });

  return {
    history: append_task_waveform_sample({
      active: true,
      history: state.history,
      sample: next_visual_sample,
    }),
    observations: next_observations,
    smoothed_speed: next_smoothed_speed,
    reference_speed: next_reference_speed,
    trend_level: next_trend_level,
    carrier_phase: next_carrier_phase,
    last_sample_time_seconds: now_seconds,
  };
}

// 只修正孤立尖峰，连续峰丘保留原貌，避免波形被处理成迟钝的平均线。
function soften_task_waveform_display_spikes(samples: number[]): number[] {
  return samples.map((sample, index) => {
    const previous_sample = samples[index - 1];
    const next_sample = samples[index + 1];
    if (previous_sample === undefined || next_sample === undefined) {
      return sample;
    }

    const neighbor_ceiling = Math.max(previous_sample, next_sample);
    if (sample <= neighbor_ceiling + TASK_WAVEFORM_DISPLAY_SPIKE_LIMIT) {
      return sample;
    }

    return neighbor_ceiling + TASK_WAVEFORM_DISPLAY_SPIKE_LIMIT;
  });
}

// 将 0..1 视觉样本转换成 canvas 绘制列高，保持组件只关心像素绘制。
export function build_task_waveform_columns(history: number[], row_count: number): number[] {
  const normalized_row_count = Math.max(1, Math.floor(normalize_non_negative_value(row_count)));
  const visible_history =
    history.length >= TASK_WAVEFORM_VISIBLE_POINTS
      ? history.slice(history.length - TASK_WAVEFORM_VISIBLE_POINTS)
      : history;
  const display_history = soften_task_waveform_display_spikes(visible_history);

  return display_history.map((sample) => {
    return Math.floor(normalize_unit_value(sample) * (normalized_row_count - 1) + 1);
  });
}

// 只检查可见窗口是否还有非零样本，用来决定收尾动画是否继续运行。
export function has_unsettled_task_waveform_tail(history: number[]): boolean {
  const visible_history =
    history.length <= TASK_WAVEFORM_VISIBLE_POINTS
      ? history
      : history.slice(history.length - TASK_WAVEFORM_VISIBLE_POINTS);

  return visible_history.some((sample) => sample > TASK_WAVEFORM_SAMPLE_ZERO_THRESHOLD);
}
