import type { JSX } from "react";
import { AppContentState } from "@frontend/widgets/app-content-state";
import "@frontend/pages/text-replacement-page/text-replacement-page.css";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import type { TextReplacementVariant } from "@frontend/pages/text-replacement-page/config";
import { TextReplacementCommandBar } from "@frontend/pages/text-replacement-page/components/text-replacement-command-bar";
import { QualityRuleConfirmDialog } from "@frontend/features/quality-rule-editor/quality-rule-confirm-dialog";
import { TextReplacementEditDialog } from "@frontend/pages/text-replacement-page/components/text-replacement-edit-dialog";
import { PresetNameDialog } from "@frontend/features/preset-editor/preset-name-dialog";
import type { TextReplacementFilterScope } from "@frontend/pages/text-replacement-page/types";
import { TextReplacementTable } from "@frontend/pages/text-replacement-page/components/text-replacement-table";
import { QualityRuleDuplicateConfirmDialog } from "@frontend/features/quality-rule-editor/quality-rule-duplicate-confirm-dialog";
import { useTextReplacementPageState } from "@frontend/pages/text-replacement-page/use-text-replacement-page-state";
import { FileDropZone } from "@frontend/widgets/file-drop-zone/file-drop-zone";
import { SearchBar, type SearchBarScopeOption } from "@frontend/widgets/search-bar/search-bar";

type TextReplacementPageProps = ScreenComponentProps & {
  variant: TextReplacementVariant;
};

const TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "quality_rule_editor.filter.scope.all",
  src: "quality_rule_editor.fields.source",
  dst: "text_replacement_page.fields.replacement",
} satisfies Record<TextReplacementFilterScope, LocaleKey>;

const TEXT_REPLACEMENT_FILTER_SCOPES: TextReplacementFilterScope[] = ["all", "src", "dst"];
/** 按译前或译后用途组装替换规则工作面。 */
export function TextReplacementPage(props: TextReplacementPageProps): JSX.Element {
  const { t } = useI18n();

  const page_state = useTextReplacementPageState(props.variant);
  const regex_state_label = page_state.table.filter_state.is_regex
    ? t("app.state.enabled")
    : t("app.state.disabled");
  const scope_button_label =
    page_state.table.filter_state.scope === "all"
      ? t("quality_rule_editor.filter.scope.label")
      : t(TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[page_state.table.filter_state.scope]);
  const scope_state_label = t(
    TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[page_state.table.filter_state.scope],
  );
  const scope_tooltip = t("app.tooltip.value", {
    TITLE: t("quality_rule_editor.filter.scope.tooltip_label"),
    VALUE: scope_state_label,
  });
  const regex_tooltip = t("app.tooltip.value", {
    TITLE: t("quality_rule_editor.filter.regex_tooltip_label"),
    VALUE: regex_state_label,
  });
  const text_replacement_scope_options: SearchBarScopeOption<TextReplacementFilterScope>[] =
    TEXT_REPLACEMENT_FILTER_SCOPES.map((scope) => {
      return {
        value: scope,
        label: t(TEXT_REPLACEMENT_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
      };
    });

  if (page_state.quality_status !== "ready") {
    return (
      <div className="text-replacement-page page-shell page-shell--full">
        {page_state.quality_status === "error" ? (
          <AppContentState
            status="error"
            message={t("text_replacement_page.feedback.load_failed")}
            on_retry={page_state.reload_quality_rule_snapshot}
          />
        ) : (
          <AppContentState status="loading" message={t("app.action.loading")} />
        )}
      </div>
    );
  }

  return (
    <div className="text-replacement-page page-shell page-shell--full">
      <SearchBar
        variant="filter"
        keyword={page_state.table.filter_state.keyword}
        placeholder={t("quality_rule_editor.filter.placeholder")}
        clear_label={t("quality_rule_editor.filter.clear")}
        invalid_message={page_state.table.invalid_filter_message}
        on_keyword_change={page_state.table.update_filter_keyword}
        scope={{
          value: page_state.table.filter_state.scope,
          button_label: scope_button_label,
          tooltip: scope_tooltip,
          options: text_replacement_scope_options,
          on_change: page_state.table.update_filter_scope,
        }}
        regex={{
          value: page_state.table.filter_state.is_regex,
          label: t("quality_rule_editor.filter.regex"),
          tooltip: regex_tooltip,
          on_change: page_state.table.update_filter_regex,
        }}
      />
      <div className="text-replacement-page__table-host">
        <FileDropZone
          label={t("app.drop.import_here")}
          disabled={page_state.readonly}
          on_path_drop={(path) => {
            void page_state.editing.import_entries_from_path(path);
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
            entries={page_state.table.filtered_entries}
            sort_state={page_state.table.sort_state}
            reorder_disabled={page_state.table.reorder_disabled}
            hit_running={page_state.hit_state.running}
            hit_ready={page_state.hit_ready}
            readonly={page_state.readonly}
            selected_entry_ids={page_state.table.selected_entry_ids}
            active_entry_id={page_state.table.active_entry_id}
            anchor_entry_id={page_state.table.selection_anchor_entry_id}
            restore_scroll_entry_id={page_state.table.restore_scroll_entry_id}
            hit_badge_by_entry_id={page_state.hit_badge_by_entry_id}
            on_sort_change={page_state.table.apply_table_sort_state}
            on_selection_change={page_state.table.apply_table_selection}
            on_open_edit={page_state.editing.open_edit_dialog}
            on_toggle_regex={page_state.toggle_regex_for_selected}
            on_toggle_case_sensitive={page_state.toggle_case_sensitive_for_selected}
            on_reorder={page_state.editing.reorder_entries}
            on_query_entry_source={page_state.query_entry_source}
            on_search_entry_relations={page_state.search_entry_relations_from_hit}
          />
        </FileDropZone>
      </div>
      <TextReplacementCommandBar
        title_key={page_state.title_key}
        enabled={page_state.enabled}
        preset_items={page_state.presets.preset_items}
        preset_menu_open={page_state.presets.preset_menu_open}
        selected_entry_count={page_state.table.selected_entry_ids.length}
        readonly={page_state.readonly}
        on_toggle_enabled={page_state.update_enabled}
        on_create={page_state.editing.open_create_dialog}
        on_delete_selected={page_state.editing.delete_selected_entries}
        on_import={page_state.editing.import_entries_from_picker}
        on_export={page_state.editing.export_entries_from_picker}
        on_open_preset_menu={page_state.presets.open_preset_menu}
        on_apply_preset={page_state.editing.apply_preset}
        on_request_reset={page_state.editing.request_reset_entries}
        on_request_save_preset={page_state.presets.request_save_preset}
        on_request_rename_preset={page_state.presets.request_rename_preset}
        on_request_delete_preset={page_state.presets.request_delete_preset}
        on_set_default_preset={page_state.presets.set_default_preset}
        on_cancel_default_preset={page_state.presets.cancel_default_preset}
        on_preset_menu_open_change={page_state.presets.set_preset_menu_open}
      />
      <TextReplacementEditDialog
        open={page_state.editing.dialog_state.open}
        mode={page_state.editing.dialog_state.mode}
        entry={page_state.editing.dialog_state.draft_entry}
        saving={page_state.editing.dialog_state.saving}
        readonly={page_state.readonly}
        invalid={page_state.editing.dialog_state.invalid}
        on_change={page_state.editing.update_dialog_draft}
        on_save={page_state.editing.save_dialog_entry}
        on_close={page_state.editing.request_close_dialog}
      />
      <QualityRuleConfirmDialog
        state={page_state.editing.confirm_state}
        on_confirm={() => {
          void page_state.editing.confirm_pending_action();
        }}
        on_close={page_state.editing.close_confirm_dialog}
      />
      <QualityRuleDuplicateConfirmDialog
        state={page_state.editing.import_confirm_state}
        on_skip={page_state.editing.import_duplicate_skip}
        on_overwrite={page_state.editing.import_duplicate_overwrite}
        on_close={page_state.editing.close_import_duplicate_confirm}
      />
      <QualityRuleConfirmDialog
        state={page_state.presets.confirm_state}
        on_confirm={page_state.presets.confirm_pending_action}
        on_close={page_state.presets.close_confirm_dialog}
      />
      <PresetNameDialog
        state={page_state.presets.preset_input_state}
        save_shortcut_variant="outlined"
        on_change={page_state.presets.update_preset_input_value}
        on_submit={() => {
          void page_state.presets.submit_preset_input();
        }}
        on_close={page_state.presets.close_preset_input_dialog}
      />
    </div>
  );
}
