import { Funnel } from "lucide-react";

import type { ScreenComponentProps } from "@/app/navigation/types";
import { useCachedProofreadingPageState } from "@/app/runtime/project-pages/project-pages-context";
import "@/pages/proofreading-page/proofreading-page.css";
import type { UseProofreadingPageStateResult } from "@/pages/proofreading-page/use-proofreading-page-state";
import { ProofreadingConfirmDialog } from "@/pages/proofreading-page/components/proofreading-confirm-dialog";
import { ProofreadingEditDialog } from "@/pages/proofreading-page/components/proofreading-edit-dialog";
import { ProofreadingFilterDialog } from "@/pages/proofreading-page/components/proofreading-filter-dialog";
import { ProofreadingTable } from "@/pages/proofreading-page/components/proofreading-table";
import type { ProofreadingSearchScope } from "@/pages/proofreading-page/types";
import { Button } from "@/shadcn/button";
import { useI18n, type LocaleKey } from "@/i18n";
import { SearchBar, type SearchBarScopeOption } from "@/widgets/search-bar/search-bar";

const PROOFREADING_SCOPE_LABEL_KEY_BY_SCOPE = {
  all: "proofreading_page.search.scope.all",
  src: "proofreading_page.search.scope.source",
  dst: "proofreading_page.search.scope.translation",
} satisfies Record<ProofreadingSearchScope, LocaleKey>;

const PROOFREADING_SEARCH_SCOPES: ProofreadingSearchScope[] = ["all", "src", "dst"];

export function ProofreadingPage(props: ScreenComponentProps): JSX.Element {
  const { t } = useI18n();
  const proofreading_page_state = useCachedProofreadingPageState<UseProofreadingPageStateResult>();
  const toolbar_disabled =
    proofreading_page_state.readonly ||
    proofreading_page_state.is_refreshing ||
    proofreading_page_state.is_mutating;
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
    <div
      className="proofreading-page page-shell page-shell--full"
      data-sidebar-collapsed={String(props.is_sidebar_collapsed)}
    >
      <SearchBar
        variant="replace"
        keyword={proofreading_page_state.search_keyword}
        placeholder={t("proofreading_page.search.placeholder")}
        clear_label={t("proofreading_page.search.clear")}
        invalid_message={proofreading_page_state.invalid_regex_message}
        disabled={toolbar_disabled}
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
          <Button
            type="button"
            size="toolbar"
            variant="ghost"
            disabled={toolbar_disabled}
            data-active={proofreading_page_state.filter_dialog_open ? "true" : undefined}
            onClick={proofreading_page_state.open_filter_dialog}
          >
            <Funnel data-icon="inline-start" />
            {t("proofreading_page.action.filter")}
          </Button>
        }
      />

      <div className="proofreading-page__table-host">
        <ProofreadingTable
          items={proofreading_page_state.visible_items}
          sort_state={proofreading_page_state.sort_state}
          selected_row_ids={proofreading_page_state.selected_row_ids}
          active_row_id={proofreading_page_state.active_row_id}
          anchor_row_id={proofreading_page_state.anchor_row_id}
          readonly={toolbar_disabled}
          on_sort_change={proofreading_page_state.apply_table_sort_state}
          on_selection_change={proofreading_page_state.apply_table_selection}
          on_open_edit={proofreading_page_state.open_edit_dialog}
          on_request_retranslate_row_ids={proofreading_page_state.request_retranslate_row_ids}
          on_request_reset_row_ids={proofreading_page_state.request_reset_row_ids}
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
        readonly={toolbar_disabled}
        on_change={proofreading_page_state.update_dialog_draft}
        on_save={proofreading_page_state.save_dialog_entry}
        on_close={proofreading_page_state.request_close_dialog}
        on_request_retranslate={proofreading_page_state.request_retranslate_row_ids}
        on_request_reset={proofreading_page_state.request_reset_row_ids}
      />

      <ProofreadingConfirmDialog
        state={proofreading_page_state.pending_mutation}
        on_confirm={proofreading_page_state.confirm_pending_mutation}
        on_close={proofreading_page_state.close_pending_mutation}
      />
    </div>
  );
}
