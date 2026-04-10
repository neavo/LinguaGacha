import '@/pages/glossary-page/glossary-page.css'
import type { ScreenComponentProps } from '@/app/navigation/types'
import { GlossaryCommandBar } from '@/pages/glossary-page/components/glossary-command-bar'
import { GlossaryEditDialog } from '@/pages/glossary-page/components/glossary-edit-dialog'
import { GlossarySearchBar } from '@/pages/glossary-page/components/glossary-search-bar'
import { GlossaryTable } from '@/pages/glossary-page/components/glossary-table'
import { useGlossaryPageState } from '@/pages/glossary-page/use-glossary-page-state'

export function GlossaryPage(props: ScreenComponentProps): JSX.Element {
  const glossary_page_state = useGlossaryPageState()

  return (
    <div
      className="glossary-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <GlossarySearchBar
        keyword={glossary_page_state.filter_state.keyword}
        scope={glossary_page_state.filter_state.scope}
        visible_count={glossary_page_state.visible_count}
        total_count={glossary_page_state.total_count}
        is_regex={glossary_page_state.filter_state.is_regex}
        invalid_filter_message={glossary_page_state.invalid_filter_message}
        has_active_filters={glossary_page_state.has_active_filters}
        on_keyword_change={glossary_page_state.update_filter_keyword}
        on_scope_change={glossary_page_state.update_filter_scope}
        on_regex_change={glossary_page_state.update_filter_regex}
        on_clear_filters={glossary_page_state.clear_all_filters}
      />
      <div className="glossary-page__table-host">
        <GlossaryTable
          entries={glossary_page_state.filtered_entries}
          total_count={glossary_page_state.total_count}
          column_filters={glossary_page_state.column_filters}
          drag_disabled={glossary_page_state.drag_disabled}
          statistics_filter_available={glossary_page_state.statistics_filter_available}
          selected_entry_ids={glossary_page_state.selected_entry_ids}
          active_entry_id={glossary_page_state.active_entry_id}
          statistics_badge_by_entry_id={glossary_page_state.statistics_badge_by_entry_id}
          on_update_column_filter={glossary_page_state.update_column_filter}
          on_select_entry={glossary_page_state.select_entry}
          on_select_range={glossary_page_state.select_range}
          on_box_select={glossary_page_state.box_select_entries}
          on_open_edit={glossary_page_state.open_edit_dialog}
          on_delete_selected={glossary_page_state.delete_selected_entries}
          on_toggle_case_sensitive={glossary_page_state.toggle_case_sensitive_for_selected}
          on_reorder={glossary_page_state.reorder_selected_entries}
          on_query_entry_source={glossary_page_state.query_entry_source_from_statistics}
          on_search_entry_relations={glossary_page_state.search_entry_relations_from_statistics}
        />
      </div>
      <GlossaryCommandBar
        enabled={glossary_page_state.enabled}
        preset_items={glossary_page_state.preset_items}
        preset_menu_open={glossary_page_state.preset_menu_open}
        selected_entry_count={glossary_page_state.selected_entry_ids.length}
        statistics_running={glossary_page_state.statistics_state.running}
        on_toggle_enabled={glossary_page_state.update_enabled}
        on_create={glossary_page_state.open_create_dialog}
        on_delete_selected={glossary_page_state.delete_selected_entries}
        on_import={glossary_page_state.import_entries_from_picker}
        on_export={glossary_page_state.export_entries_from_picker}
        on_statistics={glossary_page_state.run_statistics}
        on_open_preset_menu={glossary_page_state.open_preset_menu}
        on_apply_preset={glossary_page_state.apply_preset}
        on_preset_menu_open_change={glossary_page_state.set_preset_menu_open}
      />
      <GlossaryEditDialog
        open={glossary_page_state.dialog_state.open}
        mode={glossary_page_state.dialog_state.mode}
        entry={glossary_page_state.dialog_state.draft_entry}
        saving={glossary_page_state.dialog_state.saving}
        on_change={glossary_page_state.update_dialog_draft}
        on_save={glossary_page_state.save_dialog_entry}
        on_close={glossary_page_state.request_close_dialog}
      />
    </div>
  )
}
