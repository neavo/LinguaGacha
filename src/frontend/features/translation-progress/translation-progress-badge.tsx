import type { JSX } from "react";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type TranslationProgressBadgeProps = {
  progress: ProjectTranslationStats;
  tabIndex?: number;
};

/** 工作台提示使用后端同一份文件统计。 */
export function TranslationProgressBadge({
  progress,
  tabIndex = 0,
}: TranslationProgressBadgeProps): JSX.Element {
  const { t } = useI18n();
  const entries = [
    { label: t("task_progress.translation_skipped"), count: progress.skipped_count },
    { label: t("task_progress.translation_completed"), count: progress.completed_count },
    { label: t("task_progress.translation_pending"), count: progress.pending_count },
    { label: t("task_progress.total_lines"), count: progress.total_items },
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
          {entries.map((entry) => (
            <span key={entry.label}>
              {t("task_progress.line", { status: entry.label, count: String(entry.count) })}
            </span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
