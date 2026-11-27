import type { JSX } from "react";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { useI18n } from "@frontend/app/locale/locale-context";
import { Badge } from "@frontend/shadcn/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type TranslationProgressBadgeProps = {
  progress: ProjectTranslationStats;
  tabIndex?: number; // 文件表格显式指定焦点顺序，导航按钮内的胶囊省略此属性。
};

/** 展示完成率，提示内容按条目状态列出统计。 */
export function TranslationProgressBadge({
  progress,
  tabIndex,
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
