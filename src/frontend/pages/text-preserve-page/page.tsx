import type { JSX } from "react";
import { AppContentState } from "@frontend/widgets/app-content-state";
import "@frontend/pages/text-preserve-page/text-preserve-page.css";
import type { ScreenComponentProps } from "@frontend/app/navigation/types";
import { push_toast } from "@frontend/app/feedback/desktop-toast";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import { TextPreserveCommandBar } from "@frontend/pages/text-preserve-page/components/text-preserve-command-bar";
import { QualityRuleConfirmDialog } from "@frontend/features/quality-rule-editor/quality-rule-confirm-dialog";
import { TextPreserveEditDialog } from "@frontend/pages/text-preserve-page/components/text-preserve-edit-dialog";
import { PresetNameDialog } from "@frontend/features/preset-editor/preset-name-dialog";
import { TextPreserveTable } from "@frontend/pages/text-preserve-page/components/text-preserve-table";
import type { TextPreserveFilterScope } from "@frontend/pages/text-preserve-page/types";
import { QualityRuleDuplicateConfirmDialog } from "@frontend/features/quality-rule-editor/quality-rule-duplicate-confirm-dialog";
import { useTextPreservePageState } from "@frontend/pages/text-preserve-page/use-text-preserve-page-state";
import { FileDropZone } from "@frontend/widgets/file-drop-zone/file-drop-zone";
import { SearchBar, type SearchBarScopeOption } from "@frontend/widgets/search-bar/search-bar";

const TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "quality_rule_editor.filter.scope.all",
  src: "text_preserve_page.filter.scope.rule",
  info: "text_preserve_page.filter.scope.note",
} satisfies Record<TextPreserveFilterScope, LocaleKey>;

const TEXT_PRESERVE_FILTER_SCOPES: TextPreserveFilterScope[] = ["all", "src", "info"];
/** 组装文本保护规则的查询状态、列表与编辑操作。 */
export function TextPreservePage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();

  const page_state = useTextPreservePageState();
  const scope_button_label =
    page_state.table.filter_state.scope === "all"
      ? t("quality_rule_editor.filter.scope.label")
      : t(TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[page_state.table.filter_state.scope]);
  const scope_state_label = t(
    TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[page_state.table.filter_state.scope],
  );
  const regex_state_label = page_state.table.filter_state.is_regex
    ? t("app.state.enabled")
    : t("app.state.disabled");
  const scope_tooltip = t("app.tooltip.value", {
    TITLE: t("quality_rule_editor.filter.scope.tooltip_label"),
    VALUE: scope_state_label,
  });
  const regex_tooltip = t("app.tooltip.value", {
    TITLE: t("quality_rule_editor.filter.regex_tooltip_label"),
    VALUE: regex_state_label,
  });
  const text_preserve_scope_options: SearchBarScopeOption<TextPreserveFilterScope>[] =
    TEXT_PRESERVE_FILTER_SCOPES.map((scope) => {
      return {
        value: scope,
        label: t(TEXT_PRESERVE_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
      };
    });

  return (
    <div
      className="text-preserve-page page-shell page-shell--full"
      aria-busy={page_state.quality_status === "idle" || page_state.quality_status === "loading"}
    >
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
          options: text_preserve_scope_options,
          on_change: page_state.table.update_filter_scope,
        }}
        regex={{
          value: page_state.table.filter_state.is_regex,
          label: t("quality_rule_editor.filter.regex"),
          tooltip: regex_tooltip,
          on_change: page_state.table.update_filter_regex,
        }}
      />
      <div className="text-preserve-page__table-host">
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
          <TextPreserveTable
            title_key={page_state.title_key}
            entries={page_state.table.filtered_entries}
            sort_state={page_state.table.sort_state}
            readonly={page_state.readonly}
            reorder_disabled={page_state.table.reorder_disabled}
            hit_running={page_state.hit_state.running}
            hit_sort_available={page_state.hit_sort_available}
            selected_entry_ids={page_state.table.selected_entry_ids}
            active_entry_id={page_state.table.active_entry_id}
            anchor_entry_id={page_state.table.selection_anchor_entry_id}
            restore_scroll_entry_id={page_state.table.restore_scroll_entry_id}
            hit_badge_by_entry_id={page_state.hit_badge_by_entry_id}
            on_sort_change={page_state.table.apply_table_sort_state}
            on_selection_change={page_state.table.apply_table_selection}
            on_open_edit={page_state.editing.open_edit_dialog}
            on_reorder={page_state.editing.reorder_entries}
            on_query_entry_source={page_state.query_entry_source}
          />
        </FileDropZone>
        {page_state.quality_status === "error" && <AppContentState status="error" />}
      </div>
      <TextPreserveCommandBar
        ready={page_state.quality_status === "ready"}
        mode={page_state.mode}
        mode_updating={page_state.mode_updating}
        preset_items={page_state.presets.preset_items}
        preset_menu_open={page_state.presets.preset_menu_open}
        selected_entry_count={page_state.table.selected_entry_ids.length}
        readonly={page_state.readonly}
        on_mode_change={page_state.update_mode}
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
      <TextPreserveEditDialog
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
