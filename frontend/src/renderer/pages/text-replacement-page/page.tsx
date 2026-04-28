import "@/pages/text-replacement-page/text-replacement-page.css";
import type { ScreenComponentProps } from "@/app/navigation/types";
import { useDesktopToast } from "@/app/runtime/toast/use-desktop-toast";
import { useI18n, type LocaleKey } from "@/i18n";
import type { TextReplacementVariant } from "@/pages/text-replacement-page/config";
import { TextReplacementCommandBar } from "@/pages/text-replacement-page/components/text-replacement-command-bar";
import { TextReplacementConfirmDialog } from "@/pages/text-replacement-page/components/text-replacement-confirm-dialog";
import { TextReplacementEditDialog } from "@/pages/text-replacement-page/components/text-replacement-edit-dialog";
import { TextReplacementPresetInputDialog } from "@/pages/text-replacement-page/components/text-replacement-preset-input-dialog";
import type { TextReplacementFilterScope } from "@/pages/text-replacement-page/types";
import { TextReplacementTable } from "@/pages/text-replacement-page/components/text-replacement-table";
import { useTextReplacementPageState } from "@/pages/text-replacement-page/use-text-replacement-page-state";
import { FileDropZone } from "@/widgets/file-drop-zone/file-drop-zone";
import { SearchBar, type SearchBarScopeOption } from "@/widgets/search-bar/search-bar";

type TextReplacementPageProps = ScreenComponentProps & {
  variant: TextReplacementVariant;
};

const TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "text_replacement_page.filter.scope.all",
  src: "text_replacement_page.filter.scope.source",
  dst: "text_replacement_page.filter.scope.replacement",
} satisfies Record<TextReplacementFilterScope, LocaleKey>;

const TEXT_REPLACEMENT_FILTER_SCOPES: TextReplacementFilterScope[] = ["all", "src", "dst"];
export function TextReplacementPage(props: TextReplacementPageProps): JSX.Element {
  const { t } = useI18n();
  const { push_toast } = useDesktopToast();
  const page_state = useTextReplacementPageState(props.variant);
  const regex_state_label = page_state.filter_state.is_regex
    ? t("app.toggle.enabled")
    : t("app.toggle.disabled");
  const scope_button_label =
    page_state.filter_state.scope === "all"
      ? t("text_replacement_page.filter.scope.label")
      : t(TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope]);
  const scope_state_label = t(
    TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[page_state.filter_state.scope],
  );
  const scope_tooltip = t("text_replacement_page.toggle.status")
    .replace("{TITLE}", t("text_replacement_page.filter.scope.tooltip_label"))
    .replace("{STATE}", scope_state_label);
  const regex_tooltip = t("text_replacement_page.toggle.status")
    .replace("{TITLE}", t("text_replacement_page.filter.regex_tooltip_label"))
    .replace("{STATE}", regex_state_label);
  const text_replacement_scope_options: SearchBarScopeOption<TextReplacementFilterScope>[] =
    TEXT_REPLACEMENT_FILTER_SCOPES.map((scope) => {
      return {
        value: scope,
        label: t(TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
      };
    });

  return (
    <div
      className="text-replacement-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <SearchBar
        variant="filter"
        keyword={page_state.filter_state.keyword}
        placeholder={t("text_replacement_page.filter.placeholder")}
        clear_label={t("text_replacement_page.filter.clear")}
        invalid_message={page_state.invalid_filter_message}
        on_keyword_change={page_state.update_filter_keyword}
        scope={{
          value: page_state.filter_state.scope,
          button_label: scope_button_label,
          aria_label: t("text_replacement_page.filter.scope.label"),
          tooltip: scope_tooltip,
          options: text_replacement_scope_options,
          on_change: page_state.update_filter_scope,
        }}
        regex={{
          value: page_state.filter_state.is_regex,
          label: t("text_replacement_page.filter.regex"),
          tooltip: regex_tooltip,
          enabled_label: t("app.toggle.enabled"),
          disabled_label: t("app.toggle.disabled"),
          on_change: page_state.update_filter_regex,
        }}
      />
      <div className="text-replacement-page__table-host">
        <FileDropZone
          label={t("app.drop.import_here")}
          disabled={page_state.readonly}
          on_path_drop={(path) => {
            void page_state.import_entries_from_path(path);
          }}
          on_drop_issue={(issue) => {
            push_toast(
              "warning",
              issue === "multiple" ? t("app.drop.multiple_unavailable") : t("app.drop.unavailable"),
            );
          }}
        >
          <TextReplacementTable
            title_key={page_state.title_key}
            entries={page_state.filtered_entries}
            sort_state={page_state.sort_state}
            drag_disabled={page_state.drag_disabled}
            statistics_running={page_state.statistics_state.running}
            statistics_ready={page_state.statistics_ready}
            readonly={page_state.readonly}
            selected_entry_ids={page_state.selected_entry_ids}
            active_entry_id={page_state.active_entry_id}
            anchor_entry_id={page_state.selection_anchor_entry_id}
            statistics_badge_by_entry_id={page_state.statistics_badge_by_entry_id}
            on_sort_change={page_state.apply_table_sort_state}
            on_selection_change={page_state.apply_table_selection}
            on_open_edit={page_state.open_edit_dialog}
            on_toggle_regex={page_state.toggle_regex_for_selected}
            on_toggle_case_sensitive={page_state.toggle_case_sensitive_for_selected}
            on_reorder={page_state.reorder_selected_entries}
            on_query_entry_source={page_state.query_entry_source}
            on_search_entry_relations={page_state.search_entry_relations_from_statistics}
          />
        </FileDropZone>
      </div>
      <TextReplacementCommandBar
        title_key={page_state.title_key}
        enabled={page_state.enabled}
        preset_items={page_state.preset_items}
        preset_menu_open={page_state.preset_menu_open}
        selected_entry_count={page_state.selected_entry_ids.length}
        readonly={page_state.readonly}
        on_toggle_enabled={page_state.update_enabled}
        on_create={page_state.open_create_dialog}
        on_delete_selected={page_state.delete_selected_entries}
        on_import={page_state.import_entries_from_picker}
        on_export={page_state.export_entries_from_picker}
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
          void page_state.confirm_pending_action();
        }}
        on_close={page_state.close_confirm_dialog}
      />
      <TextReplacementPresetInputDialog
        state={page_state.preset_input_state}
        on_change={page_state.update_preset_input_value}
        on_submit={() => {
          void page_state.submit_preset_input();
        }}
        on_close={page_state.close_preset_input_dialog}
      />
    </div>
  );
}
