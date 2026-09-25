import type { JSX } from "react";
import { build_translation_task_summary_display } from "@frontend/features/batch-translation/batch-translation-display";
import { FileInput, FilePlus2, SquarePower, Trash2, type LucideIcon } from "lucide-react";

import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type { BatchTranslationTask } from "@frontend/app/session/batch-translation/use-batch-translation-task";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import type { TranslationTaskActionKind } from "@shared/batch-translation/batch-translation";

import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import { WorkbenchTranslationMenu } from "@frontend/pages/workbench-page/components/workbench-translation-menu";
import { BatchTranslationSummary } from "@frontend/features/batch-translation/batch-translation-summary";
import { useModelSelection } from "@frontend/features/model-selection/use-model-selection";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type WorkbenchCommandBarProps = {
  batch_translation_task: BatchTranslationTask;
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
  disabled: boolean;
  on_click: () => void;
};

/** 组合文件操作与批量翻译入口，任务状态和动作由会话层提供。 */
export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const model_selection = useModelSelection();
  const active_translation_task_action_kind: TranslationTaskActionKind | null =
    props.batch_translation_task.task_confirm_state?.kind ?? null;
  const summary = build_translation_task_summary_display(
    props.batch_translation_task.translation_task_metrics,
    t,
  );
  const add_file_disabled = !props.can_edit_files;
  const delete_file_disabled = !props.can_delete_selected_files;
  const actions: CommandAction[] = [
    {
      id: "add-file",
      icon: FilePlus2,
      label_key: "workbench_page.action.add_file",
      disabled: add_file_disabled,
      on_click: props.on_add_file,
    },
    {
      id: "delete-file",
      icon: Trash2,
      label_key: "app.action.delete",
      disabled: delete_file_disabled,
      on_click: props.on_delete_selected,
    },
    {
      id: "generate-translation",
      icon: FileInput,
      label_key: "workbench_page.action.generate_translation",
      disabled: !props.can_generate_translation,
      on_click: props.on_generate_translation,
    },
    {
      id: "close-project",
      icon: SquarePower,
      label_key: "workbench_page.action.close_project",
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
              active={props.batch_translation_task.translation_task_metrics.active}
              workbench_stats={props.translation_stats}
              disabled={props.batch_translation_task.translation_task_menu_disabled}
              busy={props.batch_translation_task.translation_task_menu_busy}
              model_selection={model_selection}
              active_task_action_kind={active_translation_task_action_kind}
              on_start_or_continue={
                props.batch_translation_task.request_start_or_continue_translation
              }
              on_request_reset={props.batch_translation_task.request_task_action_confirmation}
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
                  onClick={action.on_click}
                >
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                  {action.id === "add-file" ? <ShortcutKbd action="create" /> : null}
                  {action.id === "delete-file" ? <ShortcutKbd action="delete" /> : null}
                </AppButton>
              </div>
            );
          })}
        </>
      }
      hint={
        <BatchTranslationSummary
          variant="capsule"
          open_tooltip_on_start={true}
          display={summary}
          completion_percent={props.translation_stats?.completion_percent ?? null}
          on_open={props.batch_translation_task.open_translation_detail_sheet}
        />
      }
    />
  );
}
