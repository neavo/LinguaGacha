import "@/pages/name-field-extraction-page/name-field-extraction-page.css";
import type { ScreenComponentProps } from "@/app/navigation/types";
import { useI18n, type LocaleKey } from "@/i18n";
import { NameFieldExtractionCommandBar } from "@/pages/name-field-extraction-page/components/name-field-extraction-command-bar";
import { NameFieldExtractionConfirmDialog } from "@/pages/name-field-extraction-page/components/name-field-extraction-confirm-dialog";
import { NameFieldExtractionEditDialog } from "@/pages/name-field-extraction-page/components/name-field-extraction-edit-dialog";
import { NameFieldExtractionTable } from "@/pages/name-field-extraction-page/components/name-field-extraction-table";
import type { NameFieldFilterScope } from "@/pages/name-field-extraction-page/types";
import { useNameFieldExtractionPageState } from "@/pages/name-field-extraction-page/use-name-field-extraction-page-state";
import { SearchBar, type SearchBarScopeOption } from "@/widgets/search-bar/search-bar";

const NAME_FIELD_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "name_field_extraction_page.filter.scope.all",
  src: "name_field_extraction_page.filter.scope.source",
  dst: "name_field_extraction_page.filter.scope.translation",
} satisfies Record<NameFieldFilterScope, LocaleKey>;

const NAME_FIELD_FILTER_SCOPES: NameFieldFilterScope[] = ["all", "src", "dst"];

export function NameFieldExtractionPage(props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const page_state = useNameFieldExtractionPageState();
  const scope_button_label =
    page_state.filter_state.scope === "all"
      ? t("name_field_extraction_page.filter.scope.label")
      : t(NAME_FIELD_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope]);
  const scope_state_label = t(NAME_FIELD_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope]);
  const regex_state_label = page_state.filter_state.is_regex
    ? t("app.toggle.enabled")
    : t("app.toggle.disabled");
  const scope_tooltip = t("name_field_extraction_page.mode.status")
    .replace("{TITLE}", t("name_field_extraction_page.filter.scope.tooltip_label"))
    .replace("{STATE}", scope_state_label);
  const regex_tooltip = t("name_field_extraction_page.mode.status")
    .replace("{TITLE}", t("name_field_extraction_page.filter.regex_tooltip_label"))
    .replace("{STATE}", regex_state_label);
  const scope_options: SearchBarScopeOption<NameFieldFilterScope>[] = NAME_FIELD_FILTER_SCOPES.map(
    (scope) => {
      return {
        value: scope,
        label: t(NAME_FIELD_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
      };
    },
  );

  return (
    <div
      className="name-field-extraction-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <SearchBar
        variant="filter"
        keyword={page_state.filter_state.keyword}
        placeholder={t("name_field_extraction_page.filter.placeholder")}
        clear_label={t("name_field_extraction_page.filter.clear")}
        invalid_message={page_state.invalid_filter_message}
        on_keyword_change={page_state.update_filter_keyword}
        scope={{
          value: page_state.filter_state.scope,
          button_label: scope_button_label,
          aria_label: t("name_field_extraction_page.filter.scope.label"),
          tooltip: scope_tooltip,
          options: scope_options,
          on_change: page_state.update_filter_scope,
        }}
        regex={{
          value: page_state.filter_state.is_regex,
          label: t("name_field_extraction_page.filter.regex"),
          tooltip: regex_tooltip,
          enabled_label: t("app.toggle.enabled"),
          disabled_label: t("app.toggle.disabled"),
          on_change: page_state.update_filter_regex,
        }}
      />
      <div className="name-field-extraction-page__table-host">
        <NameFieldExtractionTable
          rows={page_state.filtered_rows}
          sort_state={page_state.sort_state}
          selected_row_ids={page_state.selected_row_ids}
          active_row_id={page_state.active_row_id}
          anchor_row_id={page_state.selection_anchor_row_id}
          on_sort_change={page_state.apply_table_sort_state}
          on_selection_change={page_state.apply_table_selection}
          on_open_edit={page_state.open_edit_dialog}
        />
      </div>
      <NameFieldExtractionCommandBar
        row_count={page_state.rows.length}
        pending_count={page_state.summary.untranslated}
        selected_count={page_state.selected_row_ids.length}
        run_state={page_state.run_state}
        is_running={page_state.is_running}
        glossary_import_locked={page_state.glossary_import_locked}
        on_extract={page_state.extract_rows}
        on_translate={page_state.translate_rows}
        on_delete={page_state.request_delete_selected_rows}
        on_import={page_state.import_to_glossary}
      />
      <NameFieldExtractionEditDialog
        state={page_state.dialog_state}
        on_change={page_state.update_dialog_draft}
        on_save={page_state.save_dialog_row}
        on_close={page_state.request_close_dialog}
      />
      <NameFieldExtractionConfirmDialog
        state={page_state.confirm_state}
        on_confirm={() => {
          void page_state.confirm_pending_action();
        }}
        on_close={page_state.close_confirm_dialog}
      />
    </div>
  );
}
