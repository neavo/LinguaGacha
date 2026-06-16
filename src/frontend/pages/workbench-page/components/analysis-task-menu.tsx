import { BrushCleaning, FileDown, Paintbrush, Play, Radar } from "lucide-react";

import "@frontend/pages/workbench-page/components/workbench-task.css";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  type AnalysisTaskActionKind,
  type AnalysisTaskMetrics,
} from "@shared/workbench/analysis-task";
import type { WorkbenchStats } from "@frontend/pages/workbench-page/types";
import { SegmentedProgress } from "@frontend/widgets/segmented-progress/segmented-progress";
import { Badge } from "@frontend/shadcn/badge";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";

type AnalysisTaskMenuProps = {
  analysis_task_metrics: AnalysisTaskMetrics;
  workbench_stats: WorkbenchStats;
  disabled: boolean;
  busy: boolean;
  importing: boolean;
  active_task_action_kind: AnalysisTaskActionKind | null;
  on_start_or_continue: () => Promise<void>;
  on_request_confirmation: (kind: AnalysisTaskActionKind) => void;
};
export function AnalysisTaskMenu(props: AnalysisTaskMenuProps): JSX.Element {
  const { t } = useI18n();
  const action_items_disabled = props.analysis_task_metrics.active || props.busy || props.disabled;
  const import_disabled =
    action_items_disabled || props.importing || props.analysis_task_metrics.candidate_count <= 0;
  const progress_percent = props.workbench_stats.completion_percent;
  const trigger_icon = <Radar data-icon="inline-start" />;
  const main_action_icon = <Play data-icon="inline-start" />;

  return (
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <AppDropdownMenuTrigger asChild>
            <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
              {trigger_icon}
              {t("workbench_page.action.analysis_task")}
            </AppButton>
          </AppDropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          <p>{t("workbench_page.analysis_task.menu.tooltip")}</p>
        </TooltipContent>
      </Tooltip>

      <AppDropdownMenuContent align="start" className="workbench-task__menu">
        <div className="workbench-task__menu-progress">
          <div className="workbench-task__menu-progress-head">
            <span className="workbench-task__menu-progress-label">
              {t("workbench_page.analysis_task.menu.progress")}
            </span>
            <span className="workbench-task__menu-progress-value">
              {progress_percent.toFixed(2)}%
            </span>
          </div>
          <SegmentedProgress
            stats={props.workbench_stats}
            labels={{
              skipped: t("workbench_page.stats.analysis_skipped"),
              failed: t("workbench_page.stats.analysis_failed"),
              completed: t("workbench_page.stats.analysis_completed"),
              pending: t("workbench_page.stats.analysis_pending"),
              total: t("workbench_page.stats.total_lines"),
            }}
          />
        </div>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={action_items_disabled}
            onSelect={() => {
              void props.on_start_or_continue();
            }}
          >
            {props.analysis_task_metrics.active ? (
              <Spinner data-icon="inline-start" />
            ) : (
              main_action_icon
            )}
            {t("workbench_page.action.start_analysis")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation("reset-all");
            }}
          >
            {props.active_task_action_kind === "reset-all" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <BrushCleaning data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_analysis_all")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_confirmation("reset-failed");
            }}
          >
            {props.active_task_action_kind === "reset-failed" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Paintbrush data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_analysis_failed")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={import_disabled}
            onSelect={() => {
              props.on_request_confirmation("import-glossary");
            }}
          >
            {props.importing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FileDown data-icon="inline-start" />
            )}
            {t("workbench_page.action.import_analysis_glossary")}
            {props.analysis_task_metrics.candidate_count > 0 ? (
              <Badge variant="secondary" className="ml-auto min-w-5 justify-center tabular-nums">
                {props.analysis_task_metrics.candidate_count}
              </Badge>
            ) : null}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
