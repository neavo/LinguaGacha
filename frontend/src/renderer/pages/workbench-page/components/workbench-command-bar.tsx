import { FileInput, FilePlus2, SquarePower, Trash2, type LucideIcon } from "lucide-react";

import { useActionShortcut } from "@/hooks/use-action-shortcut";
import type { AnalysisTaskRuntime } from "@/pages/workbench-page/task-runtime/use-analysis-task-runtime";
import type { TranslationTaskRuntime } from "@/pages/workbench-page/task-runtime/use-translation-task-runtime";
import { useI18n, type LocaleKey } from "@/i18n";
import type { AnalysisTaskActionKind } from "@/pages/workbench-page/task-runtime/analysis-task-model";
import type { TranslationTaskActionKind } from "@/pages/workbench-page/task-runtime/translation-task-model";
import type {
  WorkbenchStats,
  WorkbenchTaskSummaryViewModel,
  WorkbenchTaskViewState,
} from "@/pages/workbench-page/types";
import { AnalysisTaskMenu } from "@/pages/workbench-page/components/analysis-task-menu";
import { TaskRuntimeSummary } from "@/pages/workbench-page/components/task-runtime/task-runtime-summary";
import { TranslationTaskMenu } from "@/pages/workbench-page/components/translation-task-menu";
import { Button } from "@/shadcn/button";
import {
  CommandBar,
  CommandBarGroup,
  CommandBarSeparator,
} from "@/widgets/command-bar/command-bar";
import { ShortcutKbd } from "@/widgets/shortcut-kbd/shortcut-kbd";

type WorkbenchCommandBarProps = {
  translation_task_runtime: TranslationTaskRuntime;
  analysis_task_runtime: AnalysisTaskRuntime;
  active_workbench_task_view: WorkbenchTaskViewState;
  active_workbench_task_summary: WorkbenchTaskSummaryViewModel;
  translation_stats: WorkbenchStats;
  analysis_stats: WorkbenchStats;
  can_edit_files: boolean;
  selected_entry_count: number;
  can_export_translation: boolean;
  can_close_project: boolean;
  on_add_file: () => void;
  on_delete_selected: () => void;
  on_export_translation: () => void;
  on_close_project: () => void;
};

type CommandAction = {
  id: "add-file" | "delete-file" | "export-translation" | "close-project";
  icon: LucideIcon;
  label_key: LocaleKey;
  disabled: boolean;
  on_click: () => void;
};

export function WorkbenchCommandBar(props: WorkbenchCommandBarProps): JSX.Element {
  const { t } = useI18n();
  const active_translation_task_action_kind: TranslationTaskActionKind | null =
    props.translation_task_runtime.task_confirm_state?.kind ?? null;
  const active_analysis_task_action_kind: AnalysisTaskActionKind | null =
    props.analysis_task_runtime.analysis_confirm_state?.kind ?? null;
  const handle_open_task_detail =
    props.active_workbench_task_view.task_kind === "analysis"
      ? props.analysis_task_runtime.open_analysis_detail_sheet
      : props.active_workbench_task_view.task_kind === "translation"
        ? props.translation_task_runtime.open_translation_detail_sheet
        : () => {};
  const add_file_disabled = !props.can_edit_files;
  const delete_file_disabled = !props.can_edit_files || props.selected_entry_count === 0;
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
      id: "export-translation",
      icon: FileInput,
      label_key: "workbench_page.action.export_translation",
      disabled: !props.can_export_translation,
      on_click: props.on_export_translation,
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
              translation_task_metrics={props.translation_task_runtime.translation_task_metrics}
              workbench_stats={props.translation_stats}
              disabled={props.translation_task_runtime.translation_task_menu_disabled}
              busy={props.translation_task_runtime.translation_task_menu_busy}
              active_task_action_kind={active_translation_task_action_kind}
              on_start_or_continue={
                props.translation_task_runtime.request_start_or_continue_translation
              }
              on_request_confirmation={
                props.translation_task_runtime.request_task_action_confirmation
              }
            />
            <AnalysisTaskMenu
              analysis_task_metrics={props.analysis_task_runtime.analysis_task_metrics}
              workbench_stats={props.analysis_stats}
              disabled={props.analysis_task_runtime.analysis_task_menu_disabled}
              busy={props.analysis_task_runtime.analysis_task_menu_busy}
              importing={props.analysis_task_runtime.analysis_importing}
              active_task_action_kind={active_analysis_task_action_kind}
              on_start_or_continue={props.analysis_task_runtime.request_start_or_continue_analysis}
              on_request_confirmation={
                props.analysis_task_runtime.request_analysis_task_action_confirmation
              }
              on_import_glossary={props.analysis_task_runtime.request_import_analysis_glossary}
            />
          </CommandBarGroup>
          <CommandBarSeparator />
          {actions.map((action, index) => {
            const Icon = action.icon;
            const should_render_separator = index > 0 && action.id !== "delete-file";

            return (
              <div key={action.id} className="contents">
                {should_render_separator ? <CommandBarSeparator /> : null}
                <Button
                  variant="ghost"
                  size="toolbar"
                  disabled={action.disabled}
                  onClick={action.on_click}
                >
                  <Icon data-icon="inline-start" />
                  {t(action.label_key)}
                  {action.id === "add-file" ? <ShortcutKbd action="create" /> : null}
                  {action.id === "delete-file" ? <ShortcutKbd action="delete" /> : null}
                </Button>
              </div>
            );
          })}
        </>
      }
      hint={
        <TaskRuntimeSummary
          class_name="workbench-page__task-summary"
          view_model={props.active_workbench_task_summary}
          can_open={props.active_workbench_task_view.can_open_detail}
          on_open={handle_open_task_detail}
        />
      }
    />
  );
}
