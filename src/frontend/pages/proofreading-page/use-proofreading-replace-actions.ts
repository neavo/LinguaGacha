import { useCallback, type MutableRefObject } from "react";

import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  create_replace_all_plan,
  create_save_item_plan,
  type ProofreadingCommandPlan,
} from "@shared/proofreading/proofreading-command-planner";
import {
  build_proofreading_row_id,
  type ProofreadingClientItem,
  type ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import { resolve_visible_error_message } from "@frontend/app/feedback/visible-error-message";
import {
  create_search_pattern,
  find_first_translation_replace,
  matches_translation_replace_target,
  type ProofreadingCompiledSearchPattern,
} from "@frontend/pages/proofreading-page/proofreading-search-replace";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";

const PROOFREADING_REPLACE_SCAN_CHUNK_ROWS = 256;

type LocaleTextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

type ProofreadingToastPusher = (kind: "success" | "warning" | "error", message: string) => void;

type ProofreadingProjectWriteRunner = (args: {
  path: string;
  plan: ProofreadingCommandPlan | null;
  fallback_error_key: "proofreading_page.feedback.replace_failed";
  preferred_row_id?: string | null;
  pending_replace_cursor?: number | null;
  success_message_builder?: ((changed_count: number) => string) | null;
  empty_warning_message?: string | null;
  close_dialog?: boolean;
}) => Promise<void>;

type UseProofreadingReplaceActionsOptions = {
  active_row_id_ref: MutableRefObject<string | null>;
  consumed_revisions: ProjectDataSectionRevisions;
  is_refreshing: boolean;
  is_regex: boolean;
  is_writing: boolean;
  list_view: ProofreadingListView;
  proofreading_runtime_client_ref: MutableRefObject<ProofreadingApiClient>;
  readonly: boolean;
  replace_cursor_ref: MutableRefObject<number>;
  replace_text: string;
  search_keyword: string;
  push_toast: ProofreadingToastPusher;
  read_current_view_row_ids: (start: number, count: number) => Promise<string[]>;
  read_items_by_row_ids: (row_ids: string[]) => Promise<ProofreadingClientItem[]>;
  run_project_write: ProofreadingProjectWriteRunner;
  t: LocaleTextResolver;
};

type UseProofreadingReplaceActionsResult = {
  replace_next_visible_match: () => Promise<void>;
  replace_all_visible_matches: () => Promise<void>;
};

export function useProofreadingReplaceActions(
  options: UseProofreadingReplaceActionsOptions,
): UseProofreadingReplaceActionsResult {
  const replace_next_visible_match = useCallback(async (): Promise<void> => {
    if (options.readonly || options.is_refreshing || options.is_writing) {
      return;
    }

    const trimmed_keyword = options.search_keyword.trim();
    if (trimmed_keyword === "") {
      options.push_toast("warning", options.t("proofreading_page.feedback.no_match"));
      return;
    }

    let search_pattern: ProofreadingCompiledSearchPattern;
    try {
      const compiled_pattern = create_search_pattern(trimmed_keyword, options.is_regex);
      if (compiled_pattern === null) {
        options.push_toast("warning", options.t("proofreading_page.feedback.no_match"));
        return;
      }
      search_pattern = compiled_pattern;
    } catch (error) {
      options.push_toast(
        "error",
        `${options.t("proofreading_page.feedback.regex_invalid")}: ${resolve_visible_error_message(
          error,
          options.t,
          "",
        )}`,
      );
      return;
    }

    if (options.list_view.view_id === "") {
      options.push_toast("warning", options.t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let target_index = -1;
    let target_item: ProofreadingClientItem | null = null;
    for (
      let scan_start = options.replace_cursor_ref.current;
      scan_start < options.list_view.row_count;
      scan_start += PROOFREADING_REPLACE_SCAN_CHUNK_ROWS
    ) {
      const target_window =
        await options.proofreading_runtime_client_ref.current.read_proofreading_list_window({
          view_id: options.list_view.view_id,
          start: scan_start,
          count: PROOFREADING_REPLACE_SCAN_CHUNK_ROWS,
        });
      const matched_index = target_window.rows.findIndex((row) => {
        return matches_translation_replace_target({
          item: row.item,
          search_pattern,
          keyword: trimmed_keyword,
        });
      });
      if (matched_index >= 0) {
        target_index = target_window.start + matched_index;
        target_item = target_window.rows[matched_index]?.item ?? null;
        break;
      }
    }

    if (target_item === null || target_index < 0) {
      options.push_toast("warning", options.t("proofreading_page.feedback.no_match"));
      return;
    }

    const replaced_result = find_first_translation_replace({
      item: target_item,
      search_pattern,
      replacement: options.replace_text,
      is_regex: options.is_regex,
    });
    if (replaced_result === null) {
      options.push_toast("warning", options.t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    await options.run_project_write({
      path: "/api/proofreading/item/save",
      plan: create_save_item_plan({
        snapshot: {
          items: [target_item],
          section_revisions: options.consumed_revisions,
        },
        item_id: Number(target_item.item_id),
        next_dst: replaced_result.field === "dst" ? replaced_result.text : target_item.dst,
        next_name_dst: replaced_result.field === "name_dst" ? replaced_result.text : undefined,
      }),
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: build_proofreading_row_id(target_item.item_id),
      pending_replace_cursor: target_index + 1,
    });
  }, [options]);

  const replace_all_visible_matches = useCallback(async (): Promise<void> => {
    if (options.readonly || options.is_refreshing || options.is_writing) {
      return;
    }

    const trimmed_keyword = options.search_keyword.trim();
    if (trimmed_keyword === "") {
      options.push_toast("warning", options.t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    let search_pattern: ProofreadingCompiledSearchPattern;
    try {
      const compiled_pattern = create_search_pattern(trimmed_keyword, options.is_regex);
      if (compiled_pattern === null) {
        options.push_toast("warning", options.t("proofreading_page.feedback.replace_no_change"));
        return;
      }
      search_pattern = compiled_pattern;
    } catch (error) {
      options.push_toast(
        "error",
        `${options.t("proofreading_page.feedback.regex_invalid")}: ${resolve_visible_error_message(
          error,
          options.t,
          "",
        )}`,
      );
      return;
    }

    const target_row_ids = await options.read_current_view_row_ids(0, options.list_view.row_count);
    const target_items = (await options.read_items_by_row_ids(target_row_ids)).filter((item) => {
      return matches_translation_replace_target({
        item,
        search_pattern,
        keyword: trimmed_keyword,
      });
    });

    if (target_items.length === 0) {
      options.push_toast("warning", options.t("proofreading_page.feedback.replace_no_change"));
      return;
    }

    const replace_plan = create_replace_all_plan({
      snapshot: {
        items: target_items,
        section_revisions: options.consumed_revisions,
      },
      item_ids: target_items.map((item) => Number(item.item_id)),
      search_text: trimmed_keyword,
      replace_text: options.replace_text,
      is_regex: options.is_regex,
    });

    await options.run_project_write({
      path: "/api/proofreading/items/replace-all",
      plan: replace_plan,
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: options.active_row_id_ref.current,
      pending_replace_cursor: 0,
      success_message_builder: (changed_count) => {
        return options
          .t("proofreading_page.feedback.replace_done")
          .replace("{N}", changed_count.toString());
      },
      empty_warning_message: options.t("proofreading_page.feedback.replace_no_change"),
      close_dialog: true,
    });
  }, [options]);

  return {
    replace_next_visible_match,
    replace_all_visible_matches,
  };
}
