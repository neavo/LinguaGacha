import { WorkbenchCommandBar } from '@/pages/workbench-page/components/workbench-command-bar'
import { WorkbenchDialogs } from '@/pages/workbench-page/components/workbench-dialogs'
import { WorkbenchFileTable } from '@/pages/workbench-page/components/workbench-file-table'
import { WorkbenchStatsSection } from '@/pages/workbench-page/components/workbench-stats-section'
import '@/pages/workbench-page/workbench-page.css'
import { useWorkbenchLiveState } from '@/pages/workbench-page/use-workbench-live-state'

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
        project_loaded={workbench_state.project_loaded}
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
    </div>
  )
}
