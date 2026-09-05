import type { useI18n } from "@frontend/app/locale/locale-provider";
import type { BatchTranslationMetrics } from "@shared/batch-translation/batch-translation";
export type BatchTranslationTone = "neutral" | "success" | "warning";

export type BatchTranslationMetricEntry = {
  key: string;
  label: string;
  value_text: string;
  unit_text: string;
};

/**
 * BatchTranslationSummaryDisplay 是任务胶囊需要的紧凑展示数据。
 */
export type BatchTranslationSummaryDisplay = {
  status_text: string;
  trailing_text: string | null;
  tone: BatchTranslationTone;
  show_spinner: boolean;
  detail_tooltip_text: string;
};

/**
 * BatchTranslationDetailDisplay 是详情抽屉消费的完整任务展示数据。
 */
export type BatchTranslationDetailDisplay = {
  waveform_title: string;
  metrics_title: string;
  completion_percent_text: string;
  percent_tone: BatchTranslationTone;
  metric_entries: BatchTranslationMetricEntry[];
  stop_button_label: string;
  stop_disabled: boolean;
  waveform_history: number[];
};

/**
 * 将秒数截断并限制为非负值，统一输出 HH:MM:SS。
 */
function format_duration_value(
  seconds: number,
): Pick<BatchTranslationMetricEntry, "value_text" | "unit_text"> {
  const normalized_seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized_seconds / 60 / 60);
  const minutes = Math.floor((normalized_seconds % (60 * 60)) / 60);
  const remaining_seconds = normalized_seconds % 60;

  return {
    value_text: [hours, minutes, remaining_seconds]
      .map((part) => {
        return part.toString().padStart(2, "0");
      })
      .join(":"),
    unit_text: "",
  };
}

/**
 * 用 K/M 缩写压缩计数，同时把单位与数值分离给详情布局。
 */
function format_compact_metric_value(
  value: number,
  base_unit: string,
): Pick<BatchTranslationMetricEntry, "value_text" | "unit_text"> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(0),
      unit_text: base_unit,
    };
  }

  if (value < 1000 * 1000) {
    return {
      value_text: (value / 1000).toFixed(2),
      unit_text: `K${base_unit}`,
    };
  }

  return {
    value_text: (value / 1000 / 1000).toFixed(2),
    unit_text: `M${base_unit}`,
  };
}

/**
 * 按每秒千 token 阈值选择翻译速度单位。
 */
function format_speed_value(
  value: number,
): Pick<BatchTranslationMetricEntry, "value_text" | "unit_text"> {
  if (value < 1000) {
    return {
      value_text: value.toFixed(2),
      unit_text: "T/S",
    };
  }

  return {
    value_text: (value / 1000).toFixed(2),
    unit_text: "KT/S",
  };
}

/** 将详情使用的速度值压平成摘要尾部文案。 */
function format_summary_speed(value: number): string {
  const metric_value = format_speed_value(value);
  return `${metric_value.value_text} ${metric_value.unit_text}`;
}

/**
 * 摘要和进度共享停止、运行与空闲的状态色。
 */
function resolve_task_tone(args: { active: boolean; stopping: boolean }): BatchTranslationTone {
  if (args.stopping) {
    return "warning";
  }

  if (args.active) {
    return "success";
  }

  return "neutral";
}

/**
 * 按详情面板的固定顺序投影翻译任务指标。
 */
function build_translation_task_metric_entries(
  metrics: BatchTranslationMetrics,
  t: ReturnType<typeof useI18n>["t"],
): BatchTranslationMetricEntry[] {
  return [
    {
      key: "elapsed",
      label: t("batch_translation.detail.elapsed_time"),
      ...format_duration_value(metrics.elapsed_seconds),
    },
    {
      key: "remaining-time",
      label: t("batch_translation.detail.remaining_time"),
      ...format_duration_value(metrics.remaining_seconds),
    },
    {
      key: "speed",
      label: t("batch_translation.detail.average_speed"),
      ...format_speed_value(metrics.average_generation_speed),
    },
    {
      key: "input-tokens",
      label: t("batch_translation.detail.input_tokens"),
      ...format_compact_metric_value(metrics.input_tokens, "T"),
    },
    {
      key: "reasoning-tokens",
      label: t("batch_translation.detail.reasoning_tokens"),
      ...format_compact_metric_value(metrics.reasoning_tokens, "T"),
    },
    {
      key: "output-tokens",
      label: t("batch_translation.detail.output_tokens"),
      ...format_compact_metric_value(metrics.output_tokens, "T"),
    },
    {
      key: "active-requests",
      label: t("batch_translation.detail.active_requests"),
      ...format_compact_metric_value(metrics.request_in_flight_count, "Task"),
    },
  ];
}

/**
 * 将翻译任务运行态投影为命令栏摘要，空闲时不显示历史速度。
 */
export function build_translation_task_summary_display(
  metrics: BatchTranslationMetrics,
  t: ReturnType<typeof useI18n>["t"],
): BatchTranslationSummaryDisplay {
  let status_text = t("batch_translation.summary.empty");
  if (metrics.stopping) {
    status_text = t("batch_translation.summary.stopping");
  } else if (metrics.active) {
    status_text = t("batch_translation.summary.running");
  }

  const show_runtime = metrics.active || metrics.stopping;

  return {
    status_text,
    trailing_text: show_runtime ? format_summary_speed(metrics.average_generation_speed) : null,
    tone: resolve_task_tone(metrics),
    show_spinner: show_runtime,
    detail_tooltip_text: t("batch_translation.summary.detail_tooltip"),
  };
}

/**
 * 将翻译任务快照组装成详情面板契约，停止中禁用重复停止。
 */
export function build_translation_task_detail_display(args: {
  metrics: BatchTranslationMetrics;
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): BatchTranslationDetailDisplay {
  return {
    waveform_title: args.t("batch_translation.detail.waveform_title"),
    metrics_title: args.t("batch_translation.detail.metrics_title"),
    completion_percent_text: `${args.metrics.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_task_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("batch_translation.summary.stopping")
      : args.t("batch_translation.action.stop"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}
