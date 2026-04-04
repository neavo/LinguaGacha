import { useRef, type ChangeEvent } from 'react'

import { WorkbenchCommandBar } from '@/pages/workbench-page/components/WorkbenchCommandBar'
import { WorkbenchDialogs } from '@/pages/workbench-page/components/WorkbenchDialogs'
import { WorkbenchFileTable } from '@/pages/workbench-page/components/WorkbenchFileTable'
import { WorkbenchStatsSection } from '@/pages/workbench-page/components/WorkbenchStatsSection'
import { useWorkbenchMockState } from '@/pages/workbench-page/use_workbench_mock_state'

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean
}

export function WorkbenchPage(props: WorkbenchPageProps): JSX.Element {
  const add_file_input_ref = useRef<HTMLInputElement | null>(null)
  const replace_file_input_ref = useRef<HTMLInputElement | null>(null)
  const replace_target_id_ref = useRef<string | null>(null)
  const workbench_state = useWorkbenchMockState()
  const accept = workbench_state.supported_extensions.join(',')

  // 文件选择仍留在页面层，只让 hook 关心“选到文件之后该怎么改状态”。
  function open_add_file_picker(): void {
    add_file_input_ref.current?.click()
  }

  function open_replace_file_picker(entry_id: string): void {
    replace_target_id_ref.current = entry_id
    replace_file_input_ref.current?.click()
  }

  function handle_add_file_change(event: ChangeEvent<HTMLInputElement>): void {
    const next_file = event.target.files?.[0]

    if (next_file !== undefined) {
      workbench_state.add_file(next_file)
    }

    event.target.value = ''
  }

  function handle_replace_file_change(event: ChangeEvent<HTMLInputElement>): void {
    const next_file = event.target.files?.[0]
    const replace_target_id = replace_target_id_ref.current

    if (next_file !== undefined && replace_target_id !== null) {
      workbench_state.request_replace_file(replace_target_id, next_file)
    }

    replace_target_id_ref.current = null
    event.target.value = ''
  }

  return (
    <div className="workbench-page workspace-scroll" data-sidebar-collapsed={String(props.is_sidebar_collapsed)}>
      <input
        ref={add_file_input_ref}
        className="hidden"
        type="file"
        accept={accept}
        onChange={handle_add_file_change}
      />
      <input
        ref={replace_file_input_ref}
        className="hidden"
        type="file"
        accept={accept}
        onChange={handle_replace_file_change}
      />

      <WorkbenchStatsSection stats={workbench_state.stats} />
      <WorkbenchFileTable
        entries={workbench_state.entries}
        selected_entry_id={workbench_state.selected_entry_id}
        project_loaded={workbench_state.project_loaded}
        readonly={workbench_state.readonly}
        on_select={workbench_state.select_entry}
        on_replace={open_replace_file_picker}
        on_reset={workbench_state.request_reset_file}
        on_delete={workbench_state.request_delete_file}
      />
      <WorkbenchCommandBar
        can_edit_files={workbench_state.can_edit_files}
        can_export_translation={workbench_state.can_export_translation}
        can_close_project={workbench_state.can_close_project}
        on_add_file={open_add_file_picker}
        on_export_translation={workbench_state.request_export_translation}
        on_close_project={workbench_state.request_close_project}
      />
      <WorkbenchDialogs
        dialog_state={workbench_state.dialog_state}
        on_confirm={workbench_state.confirm_dialog}
        on_close={workbench_state.close_dialog}
      />
    </div>
  )
}
