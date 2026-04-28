import { BrushCleaning, FileDown, Paintbrush, Play, Radar } from "lucide-react";

import "@/pages/workbench-page/components/task-runtime/task-runtime.css";
import { useI18n } from "@/i18n";
import {
  type AnalysisTaskActionKind,
  type AnalysisTaskMetrics,
} from "@/pages/workbench-page/task-runtime/analysis-task-model";
import type { WorkbenchStats } from "@/pages/workbench-page/types";
import { WorkbenchSegmentedProgress } from "@/pages/workbench-page/components/workbench-segmented-progress";
import { Badge } from "@/shadcn/badge";
import { AppButton } from "@/widgets/app-button/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
  AppDropdownMenuTrigger,
} from "@/widgets/app-dropdown-menu/app-dropdown-menu";
import { Spinner } from "@/shadcn/spinner";

type AnalysisTaskMenuProps = {
  analysis_task_metrics: AnalysisTaskMetrics;
  workbench_stats: WorkbenchStats;
  disabled: boolean;
  busy: boolean;
  importing: boolean;
  active_task_action_kind: AnalysisTaskActionKind | null;
  on_start_or_continue: () => Promise<void>;
  on_request_confirmation: (kind: AnalysisTaskActionKind) => void;
  on_import_glossary: () => Promise<void>;
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
      <AppDropdownMenuTrigger asChild>
        <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
          {trigger_icon}
          {t("workbench_page.action.analysis_task")}
        </AppButton>
      </AppDropdownMenuTrigger>

      <AppDropdownMenuContent align="start" className="task-runtime__menu">
        <div className="task-runtime__menu-progress">
          <div className="task-runtime__menu-progress-head">
            <span className="task-runtime__menu-progress-label">
              {t("workbench_page.analysis_task.menu.progress")}
            </span>
            <span className="task-runtime__menu-progress-value">
              {progress_percent.toFixed(2)}%
            </span>
          </div>
          <WorkbenchSegmentedProgress
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
              void props.on_import_glossary();
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
