import { AlertCircle, LoaderCircle } from 'lucide-react'

import { useCachedWorkbenchLiveState } from '@/app/state/project-pages-context'
import { isProjectRuntimeV2Enabled } from '@/app/state/v2/runtime-feature'
import { WorkbenchCommandBar } from '@/pages/workbench-page/components/workbench-command-bar'
import { WorkbenchDialogs } from '@/pages/workbench-page/components/workbench-dialogs'
import { WorkbenchFileTable } from '@/pages/workbench-page/components/workbench-file-table'
import { WorkbenchStatsSection } from '@/pages/workbench-page/components/workbench-stats-section'
import { TaskRuntimeConfirmDialog } from '@/pages/workbench-page/components/task-runtime/task-runtime-confirm-dialog'
import { TaskRuntimeDetailSheet } from '@/pages/workbench-page/components/task-runtime/task-runtime-detail-sheet'
import '@/pages/workbench-page/workbench-page.css'
import { useI18n } from '@/i18n'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/shadcn/alert'
import { Button } from '@/shadcn/button'

type WorkbenchPageProps = {
  is_sidebar_collapsed: boolean
}

export function WorkbenchPage(props: WorkbenchPageProps): JSX.Element {
  const { t } = useI18n()
  const workbench_state = useCachedWorkbenchLiveState()
  const runtime_mode = isProjectRuntimeV2Enabled() ? 'v2' : 'v1'

  return (
    <div
      className="workbench-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
      data-runtime-mode={runtime_mode}
    >
      {workbench_state.refresh_error === null
        ? null
        : (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t('workbench_page.feedback.refresh_failed_title')}</AlertTitle>
              <AlertDescription>{workbench_state.refresh_error}</AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={workbench_state.is_refreshing}
                  onClick={() => {
                    void workbench_state.refresh_snapshot()
                  }}
                >
                  {workbench_state.is_refreshing
                    ? (
                        <>
                          <LoaderCircle className="animate-spin" data-icon="inline-start" />
                          {t('app.action.loading')}
                        </>
                      )
                    : t('app.action.retry')}
                </Button>
              </AlertAction>
            </Alert>
          )}
      <WorkbenchStatsSection
        stats={workbench_state.stats}
        stats_mode={workbench_state.stats_mode}
        on_toggle_stats_mode={workbench_state.toggle_stats_mode}
      />
      <WorkbenchFileTable
        entries={workbench_state.entries}
        selected_entry_ids={workbench_state.selected_entry_ids}
        active_entry_id={workbench_state.active_entry_id}
        anchor_entry_id={workbench_state.anchor_entry_id}
        readonly={workbench_state.readonly}
        on_selection_change={workbench_state.apply_table_selection}
        on_prepare_entry_action={workbench_state.prepare_entry_action}
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
        translation_task_runtime={workbench_state.translation_task_runtime}
        analysis_task_runtime={workbench_state.analysis_task_runtime}
        active_workbench_task_view={workbench_state.active_workbench_task_view}
        active_workbench_task_summary={workbench_state.active_workbench_task_summary}
        can_edit_files={workbench_state.can_edit_files}
        selected_entry_count={workbench_state.selected_entry_ids.length}
        can_export_translation={workbench_state.can_export_translation}
        can_close_project={workbench_state.can_close_project}
        on_add_file={() => {
          void workbench_state.request_add_file()
        }}
        on_delete_selected={workbench_state.request_delete_selected_files}
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
      <TaskRuntimeConfirmDialog
        view_model={workbench_state.translation_task_confirm_dialog}
        on_confirm={workbench_state.translation_task_runtime.confirm_task_action}
        on_close={workbench_state.translation_task_runtime.close_task_action_confirmation}
      />
      <TaskRuntimeConfirmDialog
        view_model={workbench_state.analysis_task_confirm_dialog}
        on_confirm={workbench_state.analysis_task_runtime.confirm_analysis_task_action}
        on_close={workbench_state.analysis_task_runtime.close_analysis_task_action_confirmation}
      />
      {workbench_state.active_workbench_task_view.task_kind === 'analysis'
        && workbench_state.active_workbench_task_detail !== null
        ? (
            <TaskRuntimeDetailSheet
              open={workbench_state.analysis_task_runtime.analysis_detail_sheet_open}
              view_model={workbench_state.active_workbench_task_detail}
              on_close={workbench_state.analysis_task_runtime.close_analysis_detail_sheet}
              on_request_stop_confirmation={() => {
                workbench_state.analysis_task_runtime.request_analysis_task_action_confirmation('stop-analysis')
              }}
            />
          )
        : workbench_state.active_workbench_task_view.task_kind === 'translation'
          && workbench_state.active_workbench_task_detail !== null
          ? (
            <TaskRuntimeDetailSheet
              open={workbench_state.translation_task_runtime.translation_detail_sheet_open}
              view_model={workbench_state.active_workbench_task_detail}
              on_close={workbench_state.translation_task_runtime.close_translation_detail_sheet}
              on_request_stop_confirmation={() => {
                workbench_state.translation_task_runtime.request_task_action_confirmation('stop-translation')
              }}
            />
            )
          : null}
    </div>
  )
}
