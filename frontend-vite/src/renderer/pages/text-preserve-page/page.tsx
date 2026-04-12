import '@/pages/text-preserve-page/text-preserve-page.css'
import type { ScreenComponentProps } from '@/app/navigation/types'
import { useI18n, type LocaleKey } from '@/i18n'
import { TextPreserveCommandBar } from '@/pages/text-preserve-page/components/text-preserve-command-bar'
import { TextPreserveConfirmDialog } from '@/pages/text-preserve-page/components/text-preserve-confirm-dialog'
import { TextPreserveEditDialog } from '@/pages/text-preserve-page/components/text-preserve-edit-dialog'
import { TextPreservePresetInputDialog } from '@/pages/text-preserve-page/components/text-preserve-preset-input-dialog'
import { TextPreserveTable } from '@/pages/text-preserve-page/components/text-preserve-table'
import type { TextPreserveFilterScope } from '@/pages/text-preserve-page/types'
import { useTextPreservePageState } from '@/pages/text-preserve-page/use-text-preserve-page-state'
import { SearchBar, type SearchBarScopeOption } from '@/widgets/search-bar/search-bar'

const TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: 'text_preserve_page.filter.scope.all',
  src: 'text_preserve_page.filter.scope.rule',
  info: 'text_preserve_page.filter.scope.note',
} satisfies Record<TextPreserveFilterScope, LocaleKey>

const TEXT_PRESERVE_FILTER_SCOPES: TextPreserveFilterScope[] = [
  'all',
  'src',
  'info',
]

export function TextPreservePage(
  props: ScreenComponentProps,
): JSX.Element {
  const { t } = useI18n()
  const page_state = useTextPreservePageState()
  const scope_button_label = page_state.filter_state.scope === 'all'
    ? t('text_preserve_page.filter.scope.label')
    : t(TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope])
  const scope_state_label = t(
    TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope],
  )
  const regex_state_label = page_state.filter_state.is_regex
    ? t('app.toggle.enabled')
    : t('app.toggle.disabled')
  const scope_tooltip = t('text_preserve_page.mode.status')
    .replace('{TITLE}', t('text_preserve_page.filter.scope.tooltip_label'))
    .replace('{STATE}', scope_state_label)
  const regex_tooltip = t('text_preserve_page.mode.status')
    .replace('{TITLE}', t('text_preserve_page.filter.regex_tooltip_label'))
    .replace('{STATE}', regex_state_label)
  const text_preserve_scope_options: SearchBarScopeOption<TextPreserveFilterScope>[] = TEXT_PRESERVE_FILTER_SCOPES.map((scope) => {
    return {
      value: scope,
      label: t(TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
    }
  })

  return (
    <div
      className="text-preserve-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <SearchBar
        variant="filter"
        keyword={page_state.filter_state.keyword}
        placeholder={t('text_preserve_page.filter.placeholder')}
        clear_label={t('text_preserve_page.filter.clear')}
        invalid_message={page_state.invalid_filter_message}
        on_keyword_change={page_state.update_filter_keyword}
        scope={{
          value: page_state.filter_state.scope,
          button_label: scope_button_label,
          aria_label: t('text_preserve_page.filter.scope.label'),
          tooltip: scope_tooltip,
          options: text_preserve_scope_options,
          on_change: page_state.update_filter_scope,
        }}
        regex={{
          value: page_state.filter_state.is_regex,
          label: t('text_preserve_page.filter.regex'),
          tooltip: regex_tooltip,
          enabled_label: t('app.toggle.enabled'),
          disabled_label: t('app.toggle.disabled'),
          on_change: page_state.update_filter_regex,
        }}
      />
      <div className="text-preserve-page__table-host">
        <TextPreserveTable
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
          on_reorder={page_state.reorder_selected_entries}
          on_query_entry_source={page_state.query_entry_source}
          on_search_entry_relations={page_state.search_entry_relations_from_statistics}
        />
      </div>
      <TextPreserveCommandBar
        title_key={page_state.title_key}
        summary_key={page_state.summary_key}
        mode={page_state.mode}
        preset_items={page_state.preset_items}
        preset_menu_open={page_state.preset_menu_open}
        selected_entry_count={page_state.selected_entry_ids.length}
        statistics_running={page_state.statistics_state.running}
        on_mode_change={page_state.update_mode}
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
      <TextPreserveEditDialog
        open={page_state.dialog_state.open}
        mode={page_state.dialog_state.mode}
        entry={page_state.dialog_state.draft_entry}
        saving={page_state.dialog_state.saving}
        validation_message={page_state.dialog_state.validation_message}
        on_change={page_state.update_dialog_draft}
        on_save={page_state.save_dialog_entry}
        on_close={page_state.request_close_dialog}
      />
      <TextPreserveConfirmDialog
        state={page_state.confirm_state}
        on_confirm={() => {
          void page_state.confirm_pending_action()
        }}
        on_close={page_state.close_confirm_dialog}
      />
      <TextPreservePresetInputDialog
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
