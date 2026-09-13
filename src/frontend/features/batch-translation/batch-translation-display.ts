import type { useI18n } from "@frontend/app/locale/locale-provider";
import type { BatchTranslationMetrics } from "@shared/batch-translation/batch-translation";
import type { BatchTranslationConfig } from "@domain/batch-translation";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
const METRIC_SCALE = 1000;

export type BatchTranslationTone = "neutral" | "success" | "warning";

export type BatchTranslationMetricEntry = {
  key: string;
  label: string;
  value_text: string;
  unit_text: string;
};

/**
 * 摘要共享运行指标，消费方决定使用胶囊或进度卡片展示。
 */
export type BatchTranslationSummaryDisplay = {
  status_text: string;
  speed_text: string | null;
  tone: BatchTranslationTone;
  detail_tooltip_text: string;
};

/**
 * BatchTranslationDetailDisplay 是详情抽屉消费的完整任务展示数据。
 */
export type BatchTranslationDetailDisplay = {
  provider: BatchTranslationProviderDisplay | null;
  waveform_title: string;
  metrics_title: string;
  completion_percent_text: string;
  percent_tone: BatchTranslationTone;
  metric_entries: BatchTranslationMetricEntry[];
  stop_button_label: string;
  stop_disabled: boolean;
  waveform_history: number[];
};

/** 接入点的三行文本直接来自本次运行快照。 */
type BatchTranslationProviderDisplay = {
  label: string;
  name: string;
  model: string;
  thinking: string;
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
  base_fraction_digits = 0, // 基础单位下计数取整，速度保留两位；K/M 缩写统一两位
): Pick<BatchTranslationMetricEntry, "value_text" | "unit_text"> {
  if (value < METRIC_SCALE) {
    return {
      value_text: value.toFixed(base_fraction_digits),
      unit_text: base_unit,
    };
  }

  if (value < METRIC_SCALE * METRIC_SCALE) {
    return {
      value_text: (value / METRIC_SCALE).toFixed(2),
      unit_text: `K${base_unit}`,
    };
  }

  return {
    value_text: (value / METRIC_SCALE / METRIC_SCALE).toFixed(2),
    unit_text: `M${base_unit}`,
  };
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
      key: "speed",
      label: t("batch_translation.detail.average_speed"),
      ...format_compact_metric_value(metrics.average_generation_speed, "T/S", 2),
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

  const speed = format_compact_metric_value(metrics.average_generation_speed, "T/S", 2);

  return {
    status_text,
    speed_text:
      metrics.active || metrics.stopping ? `${speed.value_text} ${speed.unit_text}` : null,
    tone: resolve_task_tone(metrics),
    detail_tooltip_text: t("batch_translation.summary.detail_tooltip"),
  };
}

/**
 * 将翻译任务快照组装成详情面板契约，停止中禁用重复停止。
 */
export function build_translation_task_detail_display(args: {
  config?: BatchTranslationConfig;
  metrics: BatchTranslationMetrics;
  completion_percent: number | null; // 工程完成率由共享统计提供，与本轮运行指标分开
  waveform_history: number[];
  t: ReturnType<typeof useI18n>["t"];
}): BatchTranslationDetailDisplay {
  return {
    provider: build_translation_provider(args.config, args.t),
    waveform_title: args.t("batch_translation.detail.waveform_title"),
    metrics_title: args.t("batch_translation.detail.metrics_title"),
    completion_percent_text:
      args.completion_percent === null ? "—" : `${args.completion_percent.toFixed(2)}%`,
    percent_tone: resolve_task_tone(args.metrics),
    metric_entries: build_translation_task_metric_entries(args.metrics, args.t),
    stop_button_label: args.metrics.stopping
      ? args.t("batch_translation.summary.stopping")
      : args.t("batch_translation.action.stop"),
    stop_disabled: !args.metrics.active || args.metrics.stopping,
    waveform_history: args.waveform_history,
  };
}

/** 当前运行配置直接投影显示；模型重命名与后续设置变化由各自快照隔离。 */
function build_translation_provider(
  config: BatchTranslationConfig | undefined,
  t: ReturnType<typeof useI18n>["t"],
): BatchTranslationProviderDisplay | null {
  if (config === undefined) return null;
  return {
    label: t("batch_translation.detail.provider"),
    name: config.model_name || config.model_id,
    model: config.model_id,
    thinking: t(
      config.thinking_level === null
        ? "app.model.thinking_level.default"
        : MODEL_THINKING_LEVEL_LABEL_KEY[config.thinking_level],
    ),
  };
}
