import type { JSX } from "react";
import { build_batch_task_summary_display } from "@frontend/features/batch-task/batch-task-display";
import { FileInput, FilePlus2, SquarePower, Trash2, type LucideIcon } from "lucide-react";

import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type { BatchTask } from "@frontend/app/session/batch-task/use-batch-task";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import type { TranslationTaskActionKind } from "@shared/batch-translation/batch-translation";

import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { WorkbenchTranslationMenu } from "@frontend/pages/workbench-page/components/workbench-translation-menu";
import { BatchTaskSummary } from "@frontend/features/batch-task/batch-task-summary";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import {
  get_shortcut_aria_keys,
  type ShortcutAction,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type WorkbenchCommandBarProps = {
  can_start_translation: boolean;
  on_request_start_translation: () => void;
  batch_task: BatchTask;
  translation_stats: ProjectTranslationStats | null;
  can_edit_files: boolean;
  can_delete_selected_files: boolean;
  can_generate_translation: boolean;
  can_close_project: boolean;
  on_add_file: () => void;
  on_delete_selected: () => void;
  on_generate_translation: () => void;
  on_close_project: () => void;
};

type CommandAction = {
  id: "add-file" | "delete-file" | "generate-translation" | "close-project";
  icon: LucideIcon;
  label_key: LocaleKey;
  shortcut?: ShortcutAction;
  disabled: boolean;
  on_click: () => void;
};

/** 组合文件操作与批量翻译入口，任务状态和动作由会话层提供。 */
export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const model_selection = useModelSelection();
  const active_translation_task_action_kind: TranslationTaskActionKind | null =
    props.batch_task.task_confirm_state?.kind ?? null;
  const summary = build_batch_task_summary_display({
    metrics: props.batch_task.task_metrics,
    kind: props.batch_task.task_display_snapshot?.kind ?? null,
    t,
  });
  const add_file_disabled = !props.can_edit_files;
  const delete_file_disabled = !props.can_delete_selected_files;
  const actions: CommandAction[] = [
    {
      id: "add-file",
      icon: FilePlus2,
      label_key: "workbench_page.action.add_file",
      shortcut: "create",
      disabled: add_file_disabled,
      on_click: props.on_add_file,
    },
    {
      id: "delete-file",
      icon: Trash2,
      label_key: "app.action.delete",
      shortcut: "delete",
      disabled: delete_file_disabled,
      on_click: props.on_delete_selected,
    },
    {
      id: "generate-translation",
      icon: FileInput,
      label_key: "app.translation_generation.action",
      disabled: !props.can_generate_translation,
      on_click: props.on_generate_translation,
    },
    {
      id: "close-project",
      icon: SquarePower,
      label_key: "project.close.action",
      disabled: !props.can_close_project,
      on_click: props.on_close_project,
    },
  ];

  useActionShortcut({
    action: "create",
    enabled: !add_file_disabled,
    on_trigger: props.on_add_file,
  });
  useActionShortcut({
    action: "delete",
    enabled: !delete_file_disabled,
    on_trigger: props.on_delete_selected,
  });

  return (
    <CommandBar
      className="workbench-page__task-command-bar"
      actions={
        <>
          <CommandBarGroup>
            <WorkbenchTranslationMenu
              active={props.batch_task.task_metrics.active}
              workbench_stats={props.translation_stats}
              disabled={props.batch_task.translation_task_menu_disabled}
              busy={props.batch_task.translation_task_menu_busy}
              model_selection={model_selection}
              active_task_action_kind={active_translation_task_action_kind}
              can_start={props.can_start_translation}
              on_request_start={props.on_request_start_translation}
              on_request_reset={props.batch_task.request_task_action_confirmation}
            />
          </CommandBarGroup>
          <CommandBarSeparator />
          {actions.map((action, index) => {
            const Icon = action.icon;
            const should_render_separator = index > 0 && action.id !== "delete-file";

            return (
              <div key={action.id} className="contents">
                {should_render_separator ? <CommandBarSeparator /> : null}
                <AppButton
                  variant="ghost"
                  size="toolbar"
                  disabled={action.disabled}
                  aria-keyshortcuts={
                    action.shortcut === undefined
                      ? undefined
                      : get_shortcut_aria_keys(action.shortcut)
                  }
                  onClick={action.on_click}
                >
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                  {action.shortcut === undefined ? null : <ShortcutKbd action={action.shortcut} />}
                </AppButton>
              </div>
            );
          })}
        </>
      }
      hint={
        <BatchTaskSummary
          variant="capsule"
          open_tooltip_on_start={true}
          display={summary}
          completion_percent={props.batch_task.task_metrics.completion_percent}
          on_open={props.batch_task.open_task_detail_sheet}
        />
      }
    />
  );
}
