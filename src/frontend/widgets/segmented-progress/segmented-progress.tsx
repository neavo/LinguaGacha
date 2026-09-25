import type { JSX } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import "@frontend/widgets/segmented-progress/segmented-progress.css";

export type SegmentedProgressStats = {
  total_items: number;
  completed_count: number;
  failed_count: number;
  pending_count: number;
  skipped_count: number;
  completion_percent: number;
};

export type SegmentedProgressLabels = {
  skipped: string;
  failed: string;
  completed: string;
  pending: string;
  total: string;
};

type SegmentedProgressProps = {
  stats: SegmentedProgressStats;
  labels: SegmentedProgressLabels;
};

type ProgressSegment = {
  key: "skipped" | "failed" | "completed" | "pending";
  value: number;
  label: string;
};

/** 分段宽度反映各状态占比，悬停提示保留完整统计。 */
export function SegmentedProgress(props: SegmentedProgressProps): JSX.Element {
  const segments: ProgressSegment[] = [
    {
      key: "skipped",
      value: props.stats.skipped_count,
      label: props.labels.skipped,
    },
    {
      key: "failed",
      value: props.stats.failed_count,
      label: props.labels.failed,
    },
    {
      key: "completed",
      value: props.stats.completed_count,
      label: props.labels.completed,
    },
    {
      key: "pending",
      value: props.stats.pending_count,
      label: props.labels.pending,
    },
  ];
  // 标签与图形共用状态顺序，标签额外保留零值与总数。
  const progress_label = [
    ...segments.map((segment) => `${segment.label} - ${segment.value}`),
    `${props.labels.total} - ${props.stats.total_items}`,
  ].join(" / ");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="segmented-progress"
            role="progressbar"
            aria-label={progress_label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Number(props.stats.completion_percent.toFixed(2))}
          >
            {segments.map((segment) => {
              const width_percent =
                props.stats.total_items > 0 ? (segment.value / props.stats.total_items) * 100 : 0;

              return segment.value > 0 ? (
                <span
                  key={segment.key}
                  className={`segmented-progress__segment segmented-progress__segment--${segment.key}`}
                  style={{ width: `${width_percent}%` }}
                  aria-hidden="true"
                />
              ) : null;
            })}
          </div>
        }
      />
      <TooltipContent>
        <div className="segmented-progress__tooltip">
          {segments.map((segment) => (
            <span key={segment.key} className="segmented-progress__tooltip-row">
              {segment.label} - {segment.value.toLocaleString()}
            </span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
