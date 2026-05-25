import { useMemo } from "react";

import {
  useProjectSessionBarrier,
  useProjectSessionPageCacheRegistration,
} from "@/app/session/project-session-context";
import { useI18n } from "@/app/locale/locale-provider";
import { useWorkbenchTaskRuntime } from "@/pages/workbench-page/task-runtime/workbench-task-runtime-context";
import { useWorkbenchPageState } from "@/pages/workbench-page/use-workbench-page-state";
import { WorkbenchCommandBar } from "@/pages/workbench-page/components/workbench-command-bar";
import { WorkbenchDialogs } from "@/pages/workbench-page/components/workbench-dialogs";
import { WorkbenchFileTable } from "@/pages/workbench-page/components/workbench-file-table";
import { WorkbenchStatsSection } from "@/pages/workbench-page/components/workbench-stats-section";
import { TaskRuntimeDetailSheet } from "@/pages/workbench-page/components/task-runtime/task-runtime-detail-sheet";
import { FileDropZone } from "@/widgets/file-drop-zone/file-drop-zone";
import "@/pages/workbench-page/workbench-page.css";

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean;
};

// WorkbenchPage 只组合工作台页面状态、任务运行态和页面缓存登记，不创建全局 session 事实。
export function WorkbenchPage(_props: WorkbenchPageProps): JSX.Element {
  const { t } = useI18n();
  const { create_barrier_checkpoint, wait_for_barrier } = useProjectSessionBarrier();
  const { translation_task_runtime, analysis_task_runtime } = useWorkbenchTaskRuntime();
  // 工作台页面状态拥有文件操作和列表缓存，session 只消费它声明的 barrier 快照。
  const workbench_state = useWorkbenchPageState({
    translationTaskRuntime: translation_task_runtime,
    analysisTaskRuntime: analysis_task_runtime,
    createProjectSessionBarrierCheckpoint: create_barrier_checkpoint,
    waitForProjectSessionBarrier: wait_for_barrier,
  });
  // page_cache_snapshot 只描述当前挂载页面缓存，不把工作台内部状态提升为全局事实。
  const page_cache_snapshot = useMemo(() => {
    return {
      isRefreshing: workbench_state.is_refreshing,
      consumedRevisions: workbench_state.consumed_revisions,
      requiredSections: workbench_state.required_sections,
      settledProjectPath: workbench_state.settled_project_path,
      fileOperationRunning: workbench_state.file_op_running,
    };
  }, [
    workbench_state.consumed_revisions,
    workbench_state.file_op_running,
    workbench_state.is_refreshing,
    workbench_state.required_sections,
    workbench_state.settled_project_path,
  ]);
  useProjectSessionPageCacheRegistration("workbench", page_cache_snapshot);

  return (
    <div className="workbench-page page-shell page-shell--full">
      <WorkbenchStatsSection
        stats={workbench_state.stats}
        stats_mode={workbench_state.stats_mode}
        on_toggle_stats_mode={workbench_state.toggle_stats_mode}
      />
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
          on_reorder={(ordered_entry_ids) => {
            void workbench_state.request_reorder_entries(ordered_entry_ids);
          }}
        />
      </FileDropZone>
      <WorkbenchCommandBar
        translation_task_runtime={workbench_state.translation_task_runtime}
        analysis_task_runtime={workbench_state.analysis_task_runtime}
        active_workbench_task_view={workbench_state.active_workbench_task_view}
        active_workbench_task_summary={workbench_state.active_workbench_task_summary}
        translation_stats={workbench_state.translation_stats}
        analysis_stats={workbench_state.analysis_stats}
        can_edit_files={workbench_state.can_edit_files}
        can_delete_selected_files={workbench_state.can_delete_selected_files}
        can_generate_translation={workbench_state.can_generate_translation}
        can_close_project={workbench_state.can_close_project}
        on_add_file={() => {
          void workbench_state.request_add_file();
        }}
        on_delete_selected={workbench_state.request_delete_selected_files}
        on_generate_translation={workbench_state.request_generate_translation}
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
        on_cancel={() => {
          void workbench_state.cancel_dialog();
        }}
        on_close={workbench_state.close_dialog}
      />
      {workbench_state.active_workbench_task_view.task_kind === "analysis" &&
      workbench_state.active_workbench_task_detail !== null ? (
        <TaskRuntimeDetailSheet
          open={workbench_state.analysis_task_runtime.analysis_detail_sheet_open}
          view_model={workbench_state.active_workbench_task_detail}
          on_close={workbench_state.analysis_task_runtime.close_analysis_detail_sheet}
          on_request_stop_confirmation={() => {
            workbench_state.analysis_task_runtime.request_analysis_task_action_confirmation(
              "stop-analysis",
            );
          }}
        />
      ) : workbench_state.active_workbench_task_view.task_kind === "translation" &&
        workbench_state.active_workbench_task_detail !== null ? (
        <TaskRuntimeDetailSheet
          open={workbench_state.translation_task_runtime.translation_detail_sheet_open}
          view_model={workbench_state.active_workbench_task_detail}
          on_close={workbench_state.translation_task_runtime.close_translation_detail_sheet}
          on_request_stop_confirmation={() => {
            workbench_state.translation_task_runtime.request_task_action_confirmation(
              "stop-translation",
            );
          }}
        />
      ) : null}
    </div>
  );
}
