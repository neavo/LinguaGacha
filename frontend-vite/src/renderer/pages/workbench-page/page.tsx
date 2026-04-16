import { WorkbenchCommandBar } from '@/pages/workbench-page/components/workbench-command-bar'
import { WorkbenchDialogs } from '@/pages/workbench-page/components/workbench-dialogs'
import { WorkbenchFileTable } from '@/pages/workbench-page/components/workbench-file-table'
import { WorkbenchStatsSection } from '@/pages/workbench-page/components/workbench-stats-section'
import '@/pages/workbench-page/workbench-page.css'
import { useWorkbenchLiveState } from '@/pages/workbench-page/use-workbench-live-state'
import { TranslationTaskConfirmDialog } from '@/widgets/translation-task/translation-task-confirm-dialog'
import { TranslationTaskDetailSheet } from '@/widgets/translation-task/translation-task-detail-sheet'

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean
}

export function WorkbenchPage(props: WorkbenchPageProps): JSX.Element {
  const workbench_state = useWorkbenchLiveState()

  return (
    <div
      className="workbench-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <WorkbenchStatsSection stats={workbench_state.stats} />
      <WorkbenchFileTable
        entries={workbench_state.entries}
        selected_entry_id={workbench_state.selected_entry_id}
        readonly={workbench_state.readonly}
        on_select={workbench_state.select_entry}
        on_replace={(entry_id) => {
          void workbench_state.request_replace_file(entry_id)
        }}
        on_reset={workbench_state.request_reset_file}
        on_delete={workbench_state.request_delete_file}
        on_reorder={(ordered_entry_ids) => {
          void workbench_state.request_reorder_entries(ordered_entry_ids)
        }}
      />
      <WorkbenchCommandBar
        task_runtime={workbench_state.task_runtime}
        can_edit_files={workbench_state.can_edit_files}
        can_export_translation={workbench_state.can_export_translation}
        can_close_project={workbench_state.can_close_project}
        on_add_file={() => {
          void workbench_state.request_add_file()
        }}
        on_export_translation={workbench_state.request_export_translation}
        on_close_project={workbench_state.request_close_project}
      />
      <WorkbenchDialogs
        dialog_state={workbench_state.dialog_state}
        on_confirm={() => {
          void workbench_state.confirm_dialog()
        }}
        on_close={workbench_state.close_dialog}
      />
      <TranslationTaskConfirmDialog
        state={workbench_state.task_runtime.task_confirm_state}
        on_confirm={workbench_state.task_runtime.confirm_task_action}
        on_close={workbench_state.task_runtime.close_task_action_confirmation}
      />
      <TranslationTaskDetailSheet
        open={workbench_state.task_runtime.translation_detail_sheet_open}
        translation_task_metrics={workbench_state.task_runtime.translation_task_metrics}
        translation_waveform_history={workbench_state.task_runtime.translation_waveform_history}
        on_close={workbench_state.task_runtime.close_translation_detail_sheet}
        on_request_stop_confirmation={() => {
          workbench_state.task_runtime.request_task_action_confirmation('stop-translation')
        }}
      />
    </div>
  )
}
