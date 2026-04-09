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
        keyword={glossary_page_state.search_state.keyword}
        is_regex={glossary_page_state.search_state.is_regex}
        match_count={glossary_page_state.search_state.matched_entry_ids.length}
        invalid_regex_message={glossary_page_state.search_state.invalid_regex_message}
        on_keyword_change={glossary_page_state.update_search_keyword}
        on_regex_change={glossary_page_state.update_search_regex}
        on_search={glossary_page_state.focus_next_match}
        on_previous_match={glossary_page_state.focus_previous_match}
        on_next_match={glossary_page_state.focus_next_match}
      />
      <div className="glossary-page__table-host">
        <GlossaryTable
          entries={glossary_page_state.entries}
          selected_entry_ids={glossary_page_state.selected_entry_ids}
          active_entry_id={glossary_page_state.active_entry_id}
          statistics_state={glossary_page_state.statistics_state}
          on_select_entry={glossary_page_state.select_entry}
          on_select_range={glossary_page_state.select_range}
          on_box_select={glossary_page_state.box_select_entries}
          on_open_edit={glossary_page_state.open_edit_dialog}
          on_delete_selected={glossary_page_state.delete_selected_entries}
          on_toggle_case_sensitive={glossary_page_state.toggle_case_sensitive_for_selected}
          on_reorder={glossary_page_state.reorder_selected_entries}
        />
      </div>
      <GlossaryCommandBar
        enabled={glossary_page_state.enabled}
        preset_items={glossary_page_state.preset_items}
        preset_menu_open={glossary_page_state.preset_menu_open}
        statistics_running={glossary_page_state.statistics_state.running}
        on_toggle_enabled={glossary_page_state.update_enabled}
        on_create={glossary_page_state.open_create_dialog}
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
        dirty={glossary_page_state.dialog_state.dirty}
        saving={glossary_page_state.dialog_state.saving}
        on_change={glossary_page_state.update_dialog_draft}
        on_save={glossary_page_state.save_dialog_entry}
        on_delete={glossary_page_state.delete_dialog_entry}
        on_query={glossary_page_state.query_dialog_entry}
        on_close={glossary_page_state.request_close_dialog}
      />
    </div>
  )
}
