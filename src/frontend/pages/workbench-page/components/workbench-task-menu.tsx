import { BrushCleaning, FileDown, Paintbrush, Play, Radar, ScanText } from "lucide-react";

import "@frontend/pages/workbench-page/components/workbench-task.css";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { ModelSelectionMenu } from "@frontend/features/model-selection/model-selection-menu";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import type { WorkbenchStats } from "@frontend/pages/workbench-page/types";
import { Badge } from "@frontend/shadcn/badge";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuGroup,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { SegmentedProgress } from "@frontend/widgets/segmented-progress/segmented-progress";
import type { AnalysisTaskActionKind } from "@shared/workbench/analysis-task";
import type { TranslationTaskActionKind } from "@shared/workbench/translation-task";

type WorkbenchTaskResetKind = "reset-all" | "reset-failed";

type WorkbenchTaskMenuProps = {
  active: boolean;
  workbench_stats: WorkbenchStats;
  disabled: boolean;
  busy: boolean;
  model_selection: ModelSelectionController;
  active_task_action_kind: AnalysisTaskActionKind | TranslationTaskActionKind | null;
  on_start_or_continue: () => Promise<void>;
  on_request_reset: (kind: WorkbenchTaskResetKind) => void;
} & (
  | {
      task_kind: "translation";
      analysis_import?: never;
    }
  | {
      task_kind: "analysis";
      analysis_import: {
        candidate_count: number;
        importing: boolean;
        on_request: () => void;
      };
    }
);

/**
 * 复用分析与翻译任务菜单的公共进度和控制布局。
 *
 * task_kind 负责窄化专属操作，任务生命周期仍由各自的会话 Hook 持有。
 */
export function WorkbenchTaskMenu(props: WorkbenchTaskMenuProps): JSX.Element {
  const { t } = useI18n();
  const is_analysis = props.task_kind === "analysis";
  const action_items_disabled =
    props.active || props.busy || props.disabled || props.model_selection.updating;
  const progress_percent = props.workbench_stats.completion_percent;

  return (
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <AppDropdownMenuTrigger asChild>
            <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
              {is_analysis ? (
                <Radar data-icon="inline-start" />
              ) : (
                <ScanText data-icon="inline-start" />
              )}
              {t(`workbench_page.action.${props.task_kind}_task`)}
            </AppButton>
          </AppDropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          <p>{t(`workbench_page.${props.task_kind}_task.menu.tooltip`)}</p>
        </TooltipContent>
      </Tooltip>

      <AppDropdownMenuContent align="start" className="workbench-task__menu">
        <div className="workbench-task__menu-progress">
          <div className="workbench-task__menu-progress-head">
            <span className="workbench-task__menu-progress-label">
              {t("workbench_page.task.menu.progress")}
            </span>
            <span className="workbench-task__menu-progress-value">
              {progress_percent.toFixed(2)}%
            </span>
          </div>
          <SegmentedProgress
            stats={props.workbench_stats}
            labels={{
              skipped: t(`task_progress.${props.task_kind}_skipped`),
              failed: t(`task_progress.${props.task_kind}_failed`),
              completed: t(`task_progress.${props.task_kind}_completed`),
              pending: t(`task_progress.${props.task_kind}_pending`),
              total: t("task_progress.total_lines"),
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
            {props.active ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {t(`workbench_page.action.start_${props.task_kind}`)}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        <AppDropdownMenuSeparator />

        <ModelSelectionMenu
          controller={props.model_selection}
          usage={props.task_kind}
          disabled={action_items_disabled}
        />

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_reset("reset-all");
            }}
          >
            {props.active_task_action_kind === "reset-all" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <BrushCleaning data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_task_all")}
          </AppDropdownMenuItem>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onSelect={() => {
              props.on_request_reset("reset-failed");
            }}
          >
            {props.active_task_action_kind === "reset-failed" && props.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Paintbrush data-icon="inline-start" />
            )}
            {t("workbench_page.action.reset_task_failed")}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        {props.task_kind === "analysis" ? (
          <>
            <AppDropdownMenuSeparator />

            <AppDropdownMenuGroup>
              <AppDropdownMenuItem
                disabled={
                  action_items_disabled ||
                  props.analysis_import.importing ||
                  props.analysis_import.candidate_count <= 0
                }
                onSelect={props.analysis_import.on_request}
              >
                {props.analysis_import.importing ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FileDown data-icon="inline-start" />
                )}
                {t("workbench_page.action.import_analysis_glossary")}
                {props.analysis_import.candidate_count > 0 ? (
                  <Badge
                    variant="secondary"
                    className="ml-auto min-w-5 justify-center tabular-nums"
                  >
                    {props.analysis_import.candidate_count}
                  </Badge>
                ) : null}
              </AppDropdownMenuItem>
            </AppDropdownMenuGroup>
          </>
        ) : null}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
