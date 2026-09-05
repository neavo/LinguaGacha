import { BrushCleaning, Paintbrush, Play, ScanText } from "lucide-react";

import "@frontend/pages/workbench-page/components/workbench-task.css";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { ModelSelectionMenu } from "@frontend/features/model-selection/model-selection-menu";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import type { WorkbenchStats } from "@frontend/pages/workbench-page/types";
import { Spinner } from "@frontend/shadcn/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  tooltip_trigger_target,
} from "@frontend/shadcn/tooltip";
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
import type { TranslationTaskActionKind } from "@shared/workbench/batch-translation";

type WorkbenchTaskResetKind = "reset-all" | "reset-failed";

type WorkbenchTranslationMenuProps = {
  active: boolean;
  workbench_stats: WorkbenchStats;
  disabled: boolean;
  busy: boolean;
  model_selection: ModelSelectionController;
  active_task_action_kind: TranslationTaskActionKind | null;
  on_start_or_continue: () => Promise<void>;
  on_request_reset: (kind: WorkbenchTaskResetKind) => void;
};

/**
 * 翻译任务菜单展示进度并提供模型选择、开始与重置操作。
 *
 * 运行事实来自共享 Store，确认框和完成提示由会话 Hook 持有。
 */
export function WorkbenchTranslationMenu(props: WorkbenchTranslationMenuProps): JSX.Element {
  const { t } = useI18n();
  const action_items_disabled =
    props.active || props.busy || props.disabled || props.model_selection.updating;
  const progress_percent = props.workbench_stats.completion_percent;

  return (
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={tooltip_trigger_target(
            <AppDropdownMenuTrigger
              render={
                <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
                  <ScanText data-icon="inline-start" />
                  {t(`workbench_page.action.translation_task`)}
                </AppButton>
              }
            />,
          )}
        />
        <TooltipContent side="top" sideOffset={8}>
          <p>{t(`workbench_page.translation_task.menu.tooltip`)}</p>
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
              skipped: t(`task_progress.translation_skipped`),
              failed: t(`task_progress.translation_failed`),
              completed: t(`task_progress.translation_completed`),
              pending: t(`task_progress.translation_pending`),
              total: t("task_progress.total_lines"),
            }}
          />
        </div>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={action_items_disabled}
            onClick={() => {
              void props.on_start_or_continue();
            }}
          >
            {props.active ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {t(`workbench_page.action.start_translation`)}
          </AppDropdownMenuItem>
        </AppDropdownMenuGroup>

        <AppDropdownMenuSeparator />

        <ModelSelectionMenu
          controller={props.model_selection}
          usage="translation"
          disabled={action_items_disabled}
        />

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            variant="destructive"
            disabled={action_items_disabled}
            onClick={() => {
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
            onClick={() => {
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
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
