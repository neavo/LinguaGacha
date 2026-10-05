import type { ProofreadingProjectWriteRunner } from "./proofreading-page-state-contract";
import { push_error_toast } from "@frontend/app/feedback/desktop-toast";
import { useCallback, type MutableRefObject } from "react";

import type { TextResolver } from "@shared/i18n";
import {
  create_replace_all_plan,
  create_apply_item_changes_plan,
} from "@shared/proofreading/proofreading-command-planner";
import {
  build_proofreading_row_id,
  type ProofreadingClientItem,
  type ProofreadingListView,
} from "@shared/proofreading/proofreading-types";
import {
  create_search_pattern,
  find_first_translation_replace,
  matches_translation_replace_target,
  type ProofreadingCompiledSearchPattern,
} from "@frontend/pages/proofreading-page/proofreading-search-replace";
import type { ProjectDataSectionRevisions } from "@shared/project-event";
import type { ProofreadingApiClient } from "@frontend/pages/proofreading-page/proofreading-api-client";

const PROOFREADING_REPLACE_SCAN_CHUNK_ROWS = 256;

type ProofreadingToastPusher = (kind: "success" | "warning", message: string) => void;

type UseProofreadingReplaceActionsOptions = {
  active_row_id_ref: MutableRefObject<string | null>;
  list_revisions: ProjectDataSectionRevisions; // 替换写入使用列表 query 已消费的 revision 锁
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
  close_edit_dialog: () => void;
  t: TextResolver;
};

type UseProofreadingReplaceActionsResult = {
  replace_next_visible_match: () => Promise<void>;
  replace_all_visible_matches: () => Promise<void>;
};

// 管理校对页当前匹配和全量可见匹配的替换提交。
export function useProofreadingReplaceActions(
  options: UseProofreadingReplaceActionsOptions,
): UseProofreadingReplaceActionsResult {
  /** 从当前游标找下一处真实变化，成功回灌时再推进游标。 */
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
      push_error_toast(options.t("proofreading_page.feedback.replace_failed"), error);
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
        return (
          row.kind === "item" &&
          matches_translation_replace_target({
            item: row.item,
            search_pattern,
            keyword: trimmed_keyword,
          })
        );
      });
      if (matched_index >= 0) {
        target_index = target_window.start + matched_index;
        const row = target_window.rows[matched_index];
        target_item = row?.kind === "item" ? row.item : null;
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

    // 命中的字段单独提交，姓名替换保留正文任务状态。
    await options.run_project_write({
      path: "/api/proofreading/items/update",
      plan: create_apply_item_changes_plan({
        snapshot: {
          items: [target_item],
          section_revisions: options.list_revisions,
        },
        changes: [
          {
            item_id: Number(target_item.item_id),
            [replaced_result.field]: replaced_result.text,
          },
        ],
      }),
      fallback_error_key: "proofreading_page.feedback.replace_failed",
      preferred_row_id: build_proofreading_row_id(target_item.item_id),
      pending_replace_cursor: target_index + 1,
    });
  }, [options]);

  /** 按完整查询范围替换，提交成功后结束当前编辑。 */
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
      push_error_toast(options.t("proofreading_page.feedback.replace_failed"), error);
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
        section_revisions: options.list_revisions,
      },
      item_ids: target_items.map((item) => Number(item.item_id)),
      search_text: trimmed_keyword,
      replace_text: options.replace_text,
      is_regex: options.is_regex,
    });

    const result = await options.run_project_write({
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
    });
    if (result) options.close_edit_dialog();
  }, [options]);

  return {
    replace_next_visible_match,
    replace_all_visible_matches,
  };
}
