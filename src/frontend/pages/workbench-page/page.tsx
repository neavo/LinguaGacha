import { useI18n } from "@frontend/app/locale/locale-provider";
import { useBatchTranslationSession } from "@frontend/app/session/batch-translation/batch-translation-session-context";
import { useWorkbenchPageState } from "@frontend/pages/workbench-page/use-workbench-page-state";
import { WorkbenchCommandBar } from "@frontend/pages/workbench-page/components/workbench-command-bar";
import { WorkbenchDialogs } from "@frontend/pages/workbench-page/components/workbench-dialogs";
import { WorkbenchFileTable } from "@frontend/pages/workbench-page/components/workbench-file-table";
import { WorkbenchStatsSection } from "@frontend/pages/workbench-page/components/workbench-stats-section";
import { WorkbenchTranslationDetailSheet } from "@frontend/pages/workbench-page/components/workbench-translation-detail-sheet";
import { FileDropZone } from "@frontend/widgets/file-drop-zone/file-drop-zone";
import "@frontend/pages/workbench-page/workbench-page.css";

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean;
};

// 只组合工作台页面状态和任务运行态，不创建全局 session 事实。
export function WorkbenchPage(_props: WorkbenchPageProps): JSX.Element {
  const { t } = useI18n();
  const { translation_workbench_task, translation_export } = useBatchTranslationSession();
  const workbench_state = useWorkbenchPageState({
    translationWorkbenchTask: translation_workbench_task,
  });

  return (
    <div className="workbench-page page-shell page-shell--full">
      <WorkbenchStatsSection stats={workbench_state.stats} />
      <FileDropZone
        label={t("app.drop.import_here")}
        disabled={!workbench_state.can_edit_files}
        allow_multiple_paths={true}
        on_path_drop={(path) => {
          void workbench_state.request_add_file_from_path(path);
        }}
        on_paths_drop={(paths) => {
          void workbench_state.request_add_files_from_paths(paths);
        }}
        on_drop_issue={workbench_state.notify_add_file_drop_issue}
      >
        <WorkbenchFileTable
          entries={workbench_state.entries}
          selected_entry_ids={workbench_state.selected_entry_ids}
          active_entry_id={workbench_state.active_entry_id}
          anchor_entry_id={workbench_state.anchor_entry_id}
          readonly={workbench_state.readonly}
          on_selection_change={workbench_state.apply_table_selection}
          on_prepare_entry_action={workbench_state.prepare_entry_action}
          on_reset={workbench_state.request_reset_file}
          on_reorder={workbench_state.request_reorder_entries}
        />
      </FileDropZone>
      <WorkbenchCommandBar
        translation_workbench_task={workbench_state.translation_workbench_task}
        active_workbench_task_view={workbench_state.active_workbench_task_view}
        active_workbench_task_summary={workbench_state.active_workbench_task_summary}
        translation_stats={workbench_state.translation_stats}
        can_edit_files={workbench_state.can_edit_files}
        can_delete_selected_files={workbench_state.can_delete_selected_files}
        can_generate_translation={
          workbench_state.can_generate_translation && translation_export.can_request_export
        }
        can_close_project={workbench_state.can_close_project}
        on_add_file={() => {
          void workbench_state.request_add_file();
        }}
        on_delete_selected={workbench_state.request_delete_selected_files}
        on_generate_translation={translation_export.request_export}
        on_close_project={workbench_state.request_close_project}
      />
      <WorkbenchDialogs
        dialog_state={workbench_state.dialog_state}
        on_confirm={() => {
          void workbench_state.confirm_dialog();
        }}
        on_secondary={() => {
          void workbench_state.secondary_dialog();
        }}
        on_close={workbench_state.close_dialog}
      />
      {workbench_state.active_workbench_task_detail !== null ? (
        <WorkbenchTranslationDetailSheet
          open={workbench_state.translation_workbench_task.translation_detail_sheet_open}
          display={workbench_state.active_workbench_task_detail}
          on_close={workbench_state.translation_workbench_task.close_translation_detail_sheet}
          on_request_stop_confirmation={() => {
            workbench_state.translation_workbench_task.request_task_action_confirmation(
              "stop-translation",
            );
          }}
        />
      ) : null}
    </div>
  );
}
