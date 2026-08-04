import { useEffect, useRef } from "react";

import type { ProjectSessionTableSelectionState } from "@frontend/app/session/project-session-ui-state-context";
import { are_quality_rule_entry_ids_equal } from "@frontend/features/quality-rule-editor/quality-rule-selection";

type QualityRuleIdLookup<Id extends string> = {
  has: (entry_id: Id) => boolean;
};

type UseQualityRuleSelectionPruningArgs<Id extends string> = {
  loaded: boolean;
  selected_entry_ids: readonly Id[];
  active_entry_id: Id | null;
  selection_anchor_entry_id: Id | null;
  valid_entry_ids: QualityRuleIdLookup<Id>;
  visible_entry_ids: QualityRuleIdLookup<Id>;
  set_selection_state: (state: ProjectSessionTableSelectionState) => void;
};

/** 可见结果变化后统一裁掉失效选区，页面不再各自维护同一组锚点规则。 */
export function useQualityRuleSelectionPruning<Id extends string>(
  args: UseQualityRuleSelectionPruningArgs<Id>,
): void {
  const {
    loaded,
    selected_entry_ids,
    active_entry_id,
    selection_anchor_entry_id,
    valid_entry_ids,
    visible_entry_ids,
    set_selection_state,
  } = args;

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const next_selected_entry_ids = selected_entry_ids.filter((entry_id) => {
      return valid_entry_ids.has(entry_id) && visible_entry_ids.has(entry_id);
    });
    const next_active_entry_id =
      active_entry_id !== null && visible_entry_ids.has(active_entry_id) ? active_entry_id : null;
    const next_anchor_entry_id =
      selection_anchor_entry_id !== null && visible_entry_ids.has(selection_anchor_entry_id)
        ? selection_anchor_entry_id
        : null;

    if (
      are_quality_rule_entry_ids_equal(selected_entry_ids, next_selected_entry_ids) &&
      active_entry_id === next_active_entry_id &&
      selection_anchor_entry_id === next_anchor_entry_id
    ) {
      return;
    }

    set_selection_state({
      selected_row_ids: next_selected_entry_ids,
      active_row_id: next_active_entry_id,
      anchor_row_id: next_anchor_entry_id,
    });
  }, [
    active_entry_id,
    loaded,
    selected_entry_ids,
    selection_anchor_entry_id,
    set_selection_state,
    valid_entry_ids,
    visible_entry_ids,
  ]);
}

/** 项目身份变化时同时丢弃页面结果快照和旧项目表格 session。 */
export function useQualityRuleTableSessionReset(args: {
  project_identity: string;
  reset_result_snapshot: () => void;
  reset_table_state: (options: { persist: false }) => void;
}): void {
  const { project_identity, reset_result_snapshot, reset_table_state } = args;
  const project_identity_ref = useRef(project_identity);

  useEffect(() => {
    reset_result_snapshot();
    if (project_identity_ref.current === project_identity) {
      return;
    }

    project_identity_ref.current = project_identity;
    reset_table_state({ persist: false });
  }, [project_identity, reset_result_snapshot, reset_table_state]);
}
