import { BrushCleaning, FilePlus2, Trash2, FileInput } from "lucide-react";
import type { JSX } from "react";
import { build_batch_task_summary_display } from "@frontend/features/batch-task/batch-task-display";

import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type { BatchTask } from "@frontend/app/session/batch-task/use-batch-task";
import { useI18n } from "@frontend/app/locale/locale-context";

import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { WorkbenchTranslationMenu } from "@frontend/pages/files-page/components/workbench-translation-menu";
import { BatchTaskSummary } from "@frontend/features/batch-task/batch-task-summary";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { Spinner } from "@frontend/shadcn/spinner";
import { Tooltip, TooltipContent, TooltipTarget, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import { get_shortcut_aria_keys } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type WorkbenchCommandBarProps = {
  can_start_translation: boolean;
  on_request_start_translation: () => void;
  batch_task: BatchTask;
  translation_stats: ProjectTranslationStats | null;
  can_edit_files: boolean;
  can_delete_selected_files: boolean;
  can_export_translation: boolean;
  on_add_file: () => void;
  on_delete_selected: () => void;
  on_export_translation: () => void;
};

/** 组合文件操作与批量翻译入口，任务状态和动作由会话层提供。 */
export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const model_selection = useModelSelection();
  const { batch_task } = props;
  const { task_metrics, task_confirm_state, translation_action_blocked } = batch_task;
  const reset_submitting =
    task_confirm_state?.kind === "reset-all" && task_confirm_state.submitting;
  const summary = build_batch_task_summary_display({
    metrics: task_metrics,
    kind: batch_task.task_display_snapshot?.kind ?? null,
    active_task_count: batch_task.active_task_count,
    t,
  });

  useActionShortcut({
    action: "create",
    enabled: props.can_edit_files,
    on_trigger: props.on_add_file,
  });
  useActionShortcut({
    action: "delete",
    enabled: props.can_delete_selected_files,
    on_trigger: props.on_delete_selected,
  });

  return (
    <CommandBar
      className="workbench-page__task-command-bar"
      actions={
        <>
          <CommandBarGroup>
            <WorkbenchTranslationMenu
              active={batch_task.translation_active}
              workbench_stats={props.translation_stats}
              disabled={translation_action_blocked}
              model_selection={model_selection}
              can_start={props.can_start_translation}
              on_request_start={props.on_request_start_translation}
            />
          </CommandBarGroup>
          <CommandBarSeparator />
          <Tooltip>
            <TooltipTrigger
              render={
                <TooltipTarget>
                  <AppButton
                    variant="ghost"
                    size="toolbar"
                    disabled={translation_action_blocked}
                    onClick={() => batch_task.request_task_action_confirmation("reset-all")}
                  >
                    {reset_submitting ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <BrushCleaning data-icon="inline-start" />
                    )}
                    {t("app.action.reset")}
                  </AppButton>
                </TooltipTarget>
              }
            />
            <TooltipContent>{t("workbench_page.action.reset_all_tooltip")}</TooltipContent>
          </Tooltip>
          <CommandBarSeparator />
          <AppButton
            variant="ghost"
            size="toolbar"
            disabled={!props.can_edit_files}
            aria-keyshortcuts={get_shortcut_aria_keys("create")}
            onClick={props.on_add_file}
          >
            <FilePlus2 data-icon="inline-start" />
            {t("workbench_page.action.add_file")}
            <ShortcutKbd action="create" />
          </AppButton>
          <AppButton
            variant="ghost"
            size="toolbar"
            disabled={!props.can_delete_selected_files}
            aria-keyshortcuts={get_shortcut_aria_keys("delete")}
            onClick={props.on_delete_selected}
          >
            <Trash2 data-icon="inline-start" />
            {t("app.action.delete")}
            <ShortcutKbd action="delete" />
          </AppButton>
          <CommandBarSeparator />
          <AppButton
            variant="ghost"
            size="toolbar"
            disabled={!props.can_export_translation}
            onClick={props.on_export_translation}
          >
            <FileInput data-icon="inline-start" />
            {t("app.translation_export.action")}
          </AppButton>
        </>
      }
      hint={
        <BatchTaskSummary
          variant="capsule"
          open_tooltip_on_start={true}
          display={summary}
          completion_percent={task_metrics.completion_percent}
          on_open={batch_task.open_task_detail_sheet}
        />
      }
    />
  );
}
