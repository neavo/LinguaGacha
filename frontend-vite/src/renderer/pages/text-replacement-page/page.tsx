import '@/pages/text-replacement-page/text-replacement-page.css'
import type { ScreenComponentProps } from '@/app/navigation/types'
import type { TextReplacementVariant } from '@/pages/text-replacement-page/config'
import { TextReplacementCommandBar } from '@/pages/text-replacement-page/components/text-replacement-command-bar'
import { TextReplacementConfirmDialog } from '@/pages/text-replacement-page/components/text-replacement-confirm-dialog'
import { TextReplacementEditDialog } from '@/pages/text-replacement-page/components/text-replacement-edit-dialog'
import { TextReplacementPresetInputDialog } from '@/pages/text-replacement-page/components/text-replacement-preset-input-dialog'
import { TextReplacementSearchCard } from '@/pages/text-replacement-page/components/text-replacement-search-card'
import { TextReplacementTable } from '@/pages/text-replacement-page/components/text-replacement-table'
import { useTextReplacementPageState } from '@/pages/text-replacement-page/use-text-replacement-page-state'

type TextReplacementPageProps = ScreenComponentProps & {
  variant: TextReplacementVariant
}

export function TextReplacementPage(
  props: TextReplacementPageProps,
): JSX.Element {
  const page_state = useTextReplacementPageState(props.variant)

  return (
    <div
      className="text-replacement-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <TextReplacementSearchCard
        keyword={page_state.filter_state.keyword}
        scope={page_state.filter_state.scope}
        is_regex={page_state.filter_state.is_regex}
        invalid_filter_message={page_state.invalid_filter_message}
        on_keyword_change={page_state.update_filter_keyword}
        on_scope_change={page_state.update_filter_scope}
        on_regex_change={page_state.update_filter_regex}
      />
      <div className="text-replacement-page__table-host">
        <TextReplacementTable
          title_key={page_state.title_key}
          summary_key={page_state.summary_key}
          entries={page_state.filtered_entries}
          sort_state={page_state.sort_state}
          drag_disabled={page_state.drag_disabled}
          statistics_running={page_state.statistics_state.running}
          statistics_ready={page_state.statistics_ready}
          selected_entry_ids={page_state.selected_entry_ids}
          active_entry_id={page_state.active_entry_id}
          anchor_entry_id={page_state.selection_anchor_entry_id}
          statistics_badge_by_entry_id={page_state.statistics_badge_by_entry_id}
          on_sort_change={page_state.apply_table_sort_state}
          on_selection_change={page_state.apply_table_selection}
          on_open_edit={page_state.open_edit_dialog}
          on_request_delete={page_state.request_delete_entry}
          on_toggle_regex={page_state.toggle_regex_for_selected}
          on_toggle_case_sensitive={page_state.toggle_case_sensitive_for_selected}
          on_move_selected={page_state.move_selected_entries}
          on_reorder={page_state.reorder_selected_entries}
          on_query_entry_source={page_state.query_entry_source}
          on_search_entry_relations={page_state.search_entry_relations_from_statistics}
        />
      </div>
      <TextReplacementCommandBar
        title_key={page_state.title_key}
        summary_key={page_state.summary_key}
        enabled={page_state.enabled}
        preset_items={page_state.preset_items}
        preset_menu_open={page_state.preset_menu_open}
        selected_entry_count={page_state.selected_entry_ids.length}
        statistics_running={page_state.statistics_state.running}
        on_toggle_enabled={page_state.update_enabled}
        on_create={page_state.open_create_dialog}
        on_delete_selected={page_state.delete_selected_entries}
        on_import={page_state.import_entries_from_picker}
        on_export={page_state.export_entries_from_picker}
        on_statistics={page_state.run_statistics}
        on_open_preset_menu={page_state.open_preset_menu}
        on_apply_preset={page_state.apply_preset}
        on_request_reset={page_state.request_reset_entries}
        on_request_save_preset={page_state.request_save_preset}
        on_request_rename_preset={page_state.request_rename_preset}
        on_request_delete_preset={page_state.request_delete_preset}
        on_set_default_preset={page_state.set_default_preset}
        on_cancel_default_preset={page_state.cancel_default_preset}
        on_preset_menu_open_change={page_state.set_preset_menu_open}
      />
      <TextReplacementEditDialog
        open={page_state.dialog_state.open}
        mode={page_state.dialog_state.mode}
        entry={page_state.dialog_state.draft_entry}
        saving={page_state.dialog_state.saving}
        validation_message={page_state.dialog_state.validation_message}
        on_change={page_state.update_dialog_draft}
        on_save={page_state.save_dialog_entry}
        on_close={page_state.request_close_dialog}
      />
      <TextReplacementConfirmDialog
        state={page_state.confirm_state}
        on_confirm={() => {
          void page_state.confirm_pending_action()
        }}
        on_close={page_state.close_confirm_dialog}
      />
      <TextReplacementPresetInputDialog
        state={page_state.preset_input_state}
        on_change={page_state.update_preset_input_value}
        on_submit={() => {
          void page_state.submit_preset_input()
        }}
        on_close={page_state.close_preset_input_dialog}
      />
    </div>
  )
}
