import type { WorkbenchStats } from "@/pages/workbench-page/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shadcn/tooltip";

type WorkbenchSegmentedProgressLabels = {
  skipped: string;
  failed: string;
  completed: string;
  pending: string;
  total: string;
};

type WorkbenchSegmentedProgressProps = {
  stats: WorkbenchStats;
  labels: WorkbenchSegmentedProgressLabels;
};

type WorkbenchProgressSegment = {
  key: "skipped" | "failed" | "completed" | "pending";
  value: number;
  label: string;
};

function format_progress_label(args: {
  labels: WorkbenchSegmentedProgressLabels;
  stats: WorkbenchStats;
}): string {
  return [
    `${args.labels.skipped} - ${args.stats.skipped_count}`,
    `${args.labels.failed} - ${args.stats.failed_count}`,
    `${args.labels.completed} - ${args.stats.completed_count}`,
    `${args.labels.pending} - ${args.stats.pending_count}`,
    `${args.labels.total} - ${args.stats.total_items}`,
  ].join(" / ");
}

export function WorkbenchSegmentedProgress(props: WorkbenchSegmentedProgressProps): JSX.Element {
  const segments: WorkbenchProgressSegment[] = [
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
  const progress_label = format_progress_label({
    labels: props.labels,
    stats: props.stats,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="workbench-page__segmented-progress"
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
                className={`workbench-page__segmented-progress-segment workbench-page__segmented-progress-segment--${segment.key}`}
                style={{ width: `${width_percent}%` }}
                aria-hidden="true"
              />
            ) : null;
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <div className="workbench-page__segmented-progress-tooltip">
          {segments.map((segment) => {
            return (
              <span key={segment.key} className="workbench-page__segmented-progress-tooltip-row">
                {segment.label} - {segment.value.toLocaleString()}
              </span>
            );
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
