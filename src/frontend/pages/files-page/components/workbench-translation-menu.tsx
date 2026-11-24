import type { JSX } from "react";
import { Play, ScanText } from "lucide-react";

import "@frontend/features/batch-task/batch-task.css";
import { useI18n } from "@frontend/app/locale/locale-context";
import { ModelSelectionMenu } from "@frontend/features/model-selection/model-selection-menu";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";
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

type WorkbenchTranslationMenuProps = {
  active: boolean;
  workbench_stats: ProjectTranslationStats | null;
  disabled: boolean;
  model_selection: ModelSelectionController;
  can_start: boolean;
  on_request_start: () => void;
};

/** 翻译菜单展示进度、开始翻译入口与模型选择。 */
export function WorkbenchTranslationMenu(props: WorkbenchTranslationMenuProps): JSX.Element {
  const { t } = useI18n();
  const action_items_disabled = props.active || props.disabled || props.model_selection.updating;
  const progress_percent = props.workbench_stats?.completion_percent;

  return (
    <AppDropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <TooltipTarget>
              <AppDropdownMenuTrigger
                render={
                  <AppButton type="button" size="toolbar" variant="ghost" disabled={props.disabled}>
                    <ScanText data-icon="inline-start" />
                    {t(`workbench_page.action.translation_task`)}
                  </AppButton>
                }
              />
            </TooltipTarget>
          }
        />
        <TooltipContent>
          <p>{t(`batch_translation.menu.tooltip`)}</p>
        </TooltipContent>
      </Tooltip>

      <AppDropdownMenuContent align="start" className="batch-translation__menu">
        <div className="batch-translation__menu-progress">
          <div className="batch-translation__menu-progress-head">
            <span className="batch-translation__menu-progress-label">
              {t("batch_translation.menu.progress")}
            </span>
            <span className="batch-translation__menu-progress-value">
              {progress_percent === undefined ? "—" : `${progress_percent.toFixed(2)}%`}
            </span>
          </div>
          {props.workbench_stats !== null ? (
            <SegmentedProgress
              stats={props.workbench_stats}
              labels={{
                skipped: t(`task_progress.translation_skipped`),
                completed: t(`task_progress.translation_completed`),
                pending: t(`task_progress.translation_pending`),
                total: t("task_progress.total_lines"),
              }}
            />
          ) : null}
        </div>

        <AppDropdownMenuSeparator />

        <AppDropdownMenuGroup>
          <AppDropdownMenuItem
            disabled={action_items_disabled || !props.can_start}
            onClick={props.on_request_start}
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
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}
