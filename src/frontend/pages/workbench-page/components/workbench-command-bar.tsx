import { FileInput, FilePlus2, SquarePower, Trash2, type LucideIcon } from "lucide-react";

import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import type { AnalysisWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-analysis-workbench-task";
import type { TranslationWorkbenchTask } from "@frontend/app/session/workbench-tasks/use-translation-workbench-task";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import type { AnalysisTaskActionKind } from "@shared/workbench/analysis-task";
import type { TranslationTaskActionKind } from "@shared/workbench/translation-task";
import type {
  WorkbenchStats,
  WorkbenchTaskSummaryDisplay,
  WorkbenchTaskViewState,
} from "@frontend/pages/workbench-page/types";
import { AnalysisTaskMenu } from "@frontend/pages/workbench-page/components/analysis-task-menu";
import { WorkbenchTaskSummary } from "@frontend/pages/workbench-page/components/workbench-task-summary";
import { TranslationTaskMenu } from "@frontend/pages/workbench-page/components/translation-task-menu";
import { AppButton } from "@frontend/widgets/app-button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@frontend/widgets/command-bar/command-bar";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

type WorkbenchCommandBarProps = {
  translation_workbench_task: TranslationWorkbenchTask;
  analysis_workbench_task: AnalysisWorkbenchTask;
  active_workbench_task_view: WorkbenchTaskViewState;
  active_workbench_task_summary: WorkbenchTaskSummaryDisplay;
  translation_stats: WorkbenchStats;
  analysis_stats: WorkbenchStats;
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
export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const active_translation_task_action_kind: TranslationTaskActionKind | null =
    props.translation_workbench_task.task_confirm_state?.kind ?? null;
  const active_analysis_task_action_kind: AnalysisTaskActionKind | null =
    props.analysis_workbench_task.analysis_confirm_state?.kind ?? null;
  const handle_open_task_detail =
    props.active_workbench_task_view.task_kind === "analysis"
      ? props.analysis_workbench_task.open_analysis_detail_sheet
      : props.active_workbench_task_view.task_kind === "translation"
        ? props.translation_workbench_task.open_translation_detail_sheet
        : () => {};
  const task_summary_auto_open_key =
    props.active_workbench_task_view.can_open_detail &&
    props.active_workbench_task_view.task_kind !== null &&
    props.active_workbench_task_summary.show_spinner
      ? props.active_workbench_task_view.task_kind
      : null;
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
      label_key: "workbench_page.action.delete_file",
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
      title={t("workbench_page.section.command_bar")}
      description={t("workbench_page.command.description")}
      actions={
        <>
          <CommandBarGroup>
            <TranslationTaskMenu
              translation_task_metrics={props.translation_workbench_task.translation_task_metrics}
              workbench_stats={props.translation_stats}
              disabled={props.translation_workbench_task.translation_task_menu_disabled}
              busy={props.translation_workbench_task.translation_task_menu_busy}
              active_task_action_kind={active_translation_task_action_kind}
              on_start_or_continue={
                props.translation_workbench_task.request_start_or_continue_translation
              }
              on_request_confirmation={
                props.translation_workbench_task.request_task_action_confirmation
              }
            />
            <AnalysisTaskMenu
              analysis_task_metrics={props.analysis_workbench_task.analysis_task_metrics}
              workbench_stats={props.analysis_stats}
              disabled={props.analysis_workbench_task.analysis_task_menu_disabled}
              busy={props.analysis_workbench_task.analysis_task_menu_busy}
              importing={props.analysis_workbench_task.analysis_importing}
              active_task_action_kind={active_analysis_task_action_kind}
              on_start_or_continue={
                props.analysis_workbench_task.request_start_or_continue_analysis
              }
              on_request_confirmation={
                props.analysis_workbench_task.request_analysis_task_action_confirmation
              }
              on_import_glossary={props.analysis_workbench_task.request_import_analysis_glossary}
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
        <WorkbenchTaskSummary
          class_name="workbench-page__task-summary"
          display={props.active_workbench_task_summary}
          can_open={props.active_workbench_task_view.can_open_detail}
          auto_open_key={task_summary_auto_open_key}
          on_open={handle_open_task_detail}
        />
      }
    />
  );
}
