import type { TextResolver } from "@shared/i18n";
import type { BatchTaskMetrics } from "@shared/batch-task";

const METRIC_SCALE = 1_000;
type BatchTaskTone = "neutral" | "success" | "warning";

export type BatchTaskSummaryDisplay = {
  status_text: string;
  speed_text: string | null;
  tone: BatchTaskTone;
  detail_tooltip_text: string;
};

/** 数值和量级单位分别返回，侧栏可以分别排版。 */
function format_quantity(value: number, unit: string, fraction_digits = 0) {
  if (value < METRIC_SCALE) return { value: value.toFixed(fraction_digits), unit };
  if (value < METRIC_SCALE ** 2)
    return { value: (value / METRIC_SCALE).toFixed(2), unit: "K" + unit };
  return { value: (value / METRIC_SCALE ** 2).toFixed(2), unit: "M" + unit };
}

/** 两处任务入口和波形标题共用速度格式。 */
export function format_batch_task_speed(speed: number): string {
  const { value, unit } = format_quantity(speed, "T/s", 2);
  return value + " " + unit;
}

/** 预计和累计时长都用时分秒，超过一天继续累加小时。 */
function format_duration(seconds: number): string {
  const time = Math.floor(seconds);
  return [Math.floor(time / 3600), Math.floor(time / 60) % 60, time % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/** 按侧栏顺序格式化同一份工程统计。 */
export function build_batch_task_cards(metrics: BatchTaskMetrics, t: TextResolver) {
  const { usage } = metrics;
  const entries = [
    [
      t("batch_translation.detail.elapsed_time"),
      { value: format_duration(metrics.elapsed_seconds), unit: "" },
    ],
    [
      t("batch_translation.detail.remaining_time"),
      { value: format_duration(metrics.remaining_seconds), unit: "" },
    ],
    [t("batch_translation.detail.input_tokens"), format_quantity(usage.input_tokens, "T")],
    [t("batch_translation.detail.reasoning_tokens"), format_quantity(usage.reasoning_tokens, "T")],
    [t("batch_translation.detail.output_tokens"), format_quantity(usage.output_tokens, "T")],
    [t("batch_translation.detail.average_speed"), format_quantity(metrics.average_speed, "T/s", 2)],
    [
      t("batch_translation.detail.active_requests"),
      format_quantity(metrics.request_in_flight_count, "Task"),
    ],
  ] as const;
  return entries.map(([label, amount]) => ({
    label,
    ...amount,
  }));
}

/** 活跃任务按类别选用状态文案，空闲入口省略实时速度。 */
export function build_batch_task_summary_display(
  metrics: Pick<BatchTaskMetrics, "kind" | "stopping">,
  speed: number,
  t: TextResolver,
): BatchTaskSummaryDisplay {
  const { kind, stopping } = metrics;
  const status = stopping ? "stopping" : "running";
  const status_key =
    kind === null
      ? "batch_translation.summary.empty"
      : (`batch_translation.summary.${kind}.${status}` as const);
  return {
    status_text: t(status_key),
    speed_text: kind === null ? null : format_batch_task_speed(speed),
    tone: kind === null ? "neutral" : stopping ? "warning" : "success",
    detail_tooltip_text: t("batch_translation.summary.detail_tooltip"),
  };
}
