import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type TranslationProgressBadgeProps = {
  progress: {
    completion_percent: number;
    completed_count: number;
    skipped_count: number;
    failed_count: number | null;
    pending_count: number;
  };
  total: number;
  unit: "line" | "page";
  tabIndex?: number;
};

/** 工程概览与工作台共用进度提示，胶囊外观由应用 Badge 拥有。 */
export function TranslationProgressBadge({
  progress,
  total,
  unit,
  tabIndex = 0,
}: TranslationProgressBadgeProps): JSX.Element {
  const { t } = useI18n();
  const entries = [
    { label: t("task_progress.translation_skipped"), count: progress.skipped_count },
    { label: t("task_progress.translation_failed"), count: progress.failed_count },
    { label: t("task_progress.translation_completed"), count: progress.completed_count },
    { label: t("task_progress.translation_pending"), count: progress.pending_count },
    { label: t("task_progress.total_lines"), count: total },
  ];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            tone={progress.completion_percent === 100 ? "success" : "neutral"}
            tabIndex={tabIndex}
          />
        }
      >
        {`${progress.completion_percent.toFixed(2)}%`}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-1 tabular-nums">
          {entries
            .filter((entry) => entry.count !== null)
            .map((entry) => (
              <span key={entry.label}>
                {t(`task_progress.${unit}`, { status: entry.label, count: String(entry.count) })}
              </span>
            ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
