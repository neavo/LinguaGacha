import { Funnel } from "lucide-react";
import { useMemo } from "react";

import type { ScreenComponentProps } from "@/app/navigation/types";
import { useProjectSessionPageCacheRegistration } from "@/app/session/project-session-context";
import "@/pages/proofreading-page/proofreading-page.css";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";
import { ProofreadingConfirmDialog } from "@/pages/proofreading-page/components/proofreading-confirm-dialog";
import { ProofreadingEditDialog } from "@/pages/proofreading-page/components/proofreading-edit-dialog";
import { ProofreadingFilterDialog } from "@/pages/proofreading-page/components/proofreading-filter-dialog";
import { ProofreadingTable } from "@/pages/proofreading-page/components/proofreading-table";
import type { ProofreadingSearchScope } from "@/pages/proofreading-page/types";
import { AppButton } from "@/widgets/app-button/app-button";
import { useI18n, type LocaleKey } from "@/app/locale/locale-provider";
import { SearchBar, type SearchBarScopeOption } from "@/widgets/search-bar/search-bar";

const PROOFREADING_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "proofreading_page.search.scope.all",
  src: "proofreading_page.search.scope.source",
  dst: "proofreading_page.search.scope.translation",
} satisfies Record<ProofreadingSearchScope, LocaleKey>;

// PROOFREADING_SEARCH_SCOPES 是搜索栏作用域的稳定顺序，避免菜单渲染散落魔术数组。
const PROOFREADING_SEARCH_SCOPES: ProofreadingSearchScope[] = ["all", "src", "dst"];

// ProofreadingPage 只组合校对页状态、页面缓存登记和展示组件，不持有项目事实。
export function ProofreadingPage(_props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const proofreading_page_state = useProofreadingPageState();
  // page_cache_snapshot 只在校对页挂载期间登记，卸载后不阻塞其它页面 barrier。
  const page_cache_snapshot = useMemo(() => {
    return {
      isRefreshing: proofreading_page_state.is_refreshing,
      consumedRevisions: proofreading_page_state.consumed_revisions,
      requiredSections: proofreading_page_state.required_sections,
      settledProjectPath: proofreading_page_state.settled_project_path,
    };
  }, [
    proofreading_page_state.consumed_revisions,
    proofreading_page_state.is_refreshing,
    proofreading_page_state.required_sections,
    proofreading_page_state.settled_project_path,
  ]);
  useProjectSessionPageCacheRegistration("proofreading", page_cache_snapshot);
  const search_disabled = proofreading_page_state.readonly || proofreading_page_state.is_mutating;
  const table_action_disabled = search_disabled || proofreading_page_state.is_refreshing;
  const filter_disabled = table_action_disabled || proofreading_page_state.cache_status !== "ready";
  const regex_state_label = proofreading_page_state.is_regex
    ? t("app.toggle.enabled")
    : t("app.toggle.disabled");
  const scope_button_label =
    proofreading_page_state.search_scope === "all"
      ? t("proofreading_page.search.scope.label")
      : t(PROOFREADING_SCOPE_LABEL_KEY_BY_SCOPE[proofreading_page_state.search_scope]);
  const scope_state_label = t(
    PROOFREADING_SCOPE_LABEL_KEY_BY_SCOPE[proofreading_page_state.search_scope],
  );
  const scope_tooltip = t("proofreading_page.toggle.status")
    .replace("{TITLE}", t("proofreading_page.search.scope.tooltip_label"))
    .replace("{STATE}", scope_state_label);
  const regex_tooltip = t("proofreading_page.toggle.status")
    .replace("{TITLE}", t("proofreading_page.search.regex_tooltip_label"))
    .replace("{STATE}", regex_state_label);
  const proofreading_scope_options: SearchBarScopeOption<ProofreadingSearchScope>[] =
    PROOFREADING_SEARCH_SCOPES.map((scope) => {
      return {
        value: scope,
        label: t(PROOFREADING_SCOPE_LABEL_KEY_BY_SCOPE[scope]),
      };
    });

  return (
    <div className="proofreading-page page-shell page-shell--full">
      <SearchBar
        variant="replace"
        keyword={proofreading_page_state.search_keyword}
        placeholder={t("proofreading_page.search.placeholder")}
        clear_label={t("proofreading_page.search.clear")}
        invalid_message={proofreading_page_state.invalid_regex_message}
        disabled={search_disabled}
        on_keyword_change={proofreading_page_state.update_search_keyword}
        replace_text={proofreading_page_state.replace_text}
        replace_placeholder={t("proofreading_page.search.replace_placeholder")}
        replace_clear_label={t("proofreading_page.search.replace_clear")}
        on_replace_text_change={proofreading_page_state.update_replace_text}
        replace_next_label={t("proofreading_page.action.replace")}
        replace_all_label={t("proofreading_page.action.replace_all")}
        on_replace_next={proofreading_page_state.replace_next_visible_match}
        on_replace_all={proofreading_page_state.replace_all_visible_matches}
        scope={{
          value: proofreading_page_state.search_scope,
          button_label: scope_button_label,
          aria_label: t("proofreading_page.search.scope.label"),
          tooltip: scope_tooltip,
          options: proofreading_scope_options,
          on_change: proofreading_page_state.update_search_scope,
        }}
        regex={{
          value: proofreading_page_state.is_regex,
          label: t("proofreading_page.search.regex"),
          tooltip: regex_tooltip,
          enabled_label: t("app.toggle.enabled"),
          disabled_label: t("app.toggle.disabled"),
          on_change: proofreading_page_state.update_regex,
        }}
        extra_actions={
          <AppButton
            type="button"
            size="toolbar"
            variant="ghost"
            disabled={filter_disabled}
            data-active={proofreading_page_state.filter_dialog_open ? "true" : undefined}
            onClick={proofreading_page_state.open_filter_dialog}
          >
            <Funnel data-icon="inline-start" />
            {t("proofreading_page.action.filter")}
          </AppButton>
        }
      />

      <div className="proofreading-page__table-host">
        <ProofreadingTable
          items={proofreading_page_state.visible_items}
          visible_row_count={proofreading_page_state.visible_row_count}
          sort_state={proofreading_page_state.sort_state}
          selected_row_ids={proofreading_page_state.selected_row_ids}
          active_row_id={proofreading_page_state.active_row_id}
          anchor_row_id={proofreading_page_state.anchor_row_id}
          retranslating_row_ids={proofreading_page_state.retranslating_row_ids}
          readonly={table_action_disabled}
          get_row_at_index={proofreading_page_state.get_visible_row_at_index}
          get_row_id_at_index={proofreading_page_state.get_visible_row_id_at_index}
          resolve_row_index={proofreading_page_state.resolve_visible_row_index}
          resolve_row_index_async={proofreading_page_state.resolve_visible_row_index_async}
          resolve_row_ids_range={proofreading_page_state.resolve_visible_row_ids_range}
          on_visible_range_change={proofreading_page_state.read_visible_range}
          restore_scroll_row_id={proofreading_page_state.restore_scroll_row_id}
          on_sort_change={proofreading_page_state.apply_table_sort_state}
          on_selection_change={proofreading_page_state.apply_table_selection}
          on_selection_error={proofreading_page_state.handle_table_selection_error}
          on_open_edit={proofreading_page_state.open_edit_dialog}
          on_request_retranslate_row_ids={proofreading_page_state.request_retranslate_row_ids}
          on_request_clear_translation_row_ids={
            proofreading_page_state.request_clear_translation_row_ids
          }
          on_request_set_translation_status_row_ids={
            proofreading_page_state.request_set_translation_status_row_ids
          }
        />
      </div>

      <ProofreadingFilterDialog
        open={proofreading_page_state.filter_dialog_open}
        filters={proofreading_page_state.filter_dialog_filters}
        panel={proofreading_page_state.filter_panel}
        loading={proofreading_page_state.filter_panel_loading}
        on_change={proofreading_page_state.update_filter_dialog_filters}
        on_confirm={proofreading_page_state.confirm_filter_dialog_filters}
        on_close={proofreading_page_state.close_filter_dialog}
      />

      <ProofreadingEditDialog
        open={proofreading_page_state.dialog_state.open}
        item={proofreading_page_state.dialog_item}
        draft_dst={proofreading_page_state.dialog_state.draft_dst}
        saving={proofreading_page_state.dialog_state.saving}
        readonly={table_action_disabled}
        on_change={proofreading_page_state.update_dialog_draft}
        on_save={proofreading_page_state.save_dialog_entry}
        on_close={proofreading_page_state.request_close_dialog}
        on_request_retranslate={proofreading_page_state.request_retranslate_row_ids}
        on_request_clear_translation={proofreading_page_state.request_clear_translation_row_ids}
        on_request_set_translation_status={
          proofreading_page_state.request_set_translation_status_row_ids
        }
      />

      <ProofreadingConfirmDialog
        state={proofreading_page_state.pending_confirmation}
        on_confirm={proofreading_page_state.confirm_pending_confirmation}
        on_close={proofreading_page_state.close_pending_confirmation}
      />
    </div>
  );
}
