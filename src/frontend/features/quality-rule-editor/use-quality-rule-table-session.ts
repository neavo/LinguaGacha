import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import type { ProjectSessionTableSelectionState } from "@frontend/app/session/project-session-ui-state-context";
import { are_quality_rule_entry_ids_equal } from "@frontend/features/quality-rule-editor/quality-rule-selection";
import type { DebouncedCallback } from "@frontend/widgets/interactions/use-debounce";

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

type QualityRuleFilterState<Scope extends string> = {
  keyword: string;
  scope: Scope;
  is_regex: boolean;
};

type UseQualityRuleResultControlsArgs<Scope extends string, SortState, TableSortState, Snapshot> = {
  filter_state: QualityRuleFilterState<Scope>;
  sort_state: SortState;
  build_result_snapshot: (
    filter_state: QualityRuleFilterState<Scope>,
    sort_state: SortState,
  ) => Snapshot;
  set_result_snapshot: Dispatch<SetStateAction<Snapshot | null>>;
  set_filter_state: (filter_state: QualityRuleFilterState<Scope>) => void;
  set_sort_state: (sort_state: SortState) => void;
  debounced_result_snapshot: Pick<
    DebouncedCallback<[QualityRuleFilterState<Scope>, SortState]>,
    "schedule" | "cancel"
  >;
  resolve_sort_state: (sort_state: TableSortState) => SortState;
};

/** 质量规则页统一协调即时控件状态、冻结结果快照和防抖刷新。 */
export function useQualityRuleResultControls<
  Scope extends string,
  SortState,
  TableSortState,
  Snapshot,
>(
  args: UseQualityRuleResultControlsArgs<Scope, SortState, TableSortState, Snapshot>,
): {
  update_filter_keyword: (keyword: string) => void;
  update_filter_scope: (scope: Scope) => void;
  update_filter_regex: (is_regex: boolean) => void;
  apply_table_sort_state: (sort_state: TableSortState) => void;
} {
  const {
    filter_state,
    sort_state,
    build_result_snapshot,
    set_result_snapshot,
    set_filter_state,
    set_sort_state,
    debounced_result_snapshot,
    resolve_sort_state,
  } = args;

  // 输入变化先冻结旧查询结果，避免防抖窗口内把新条件应用到旧成员集合。
  const update_filter_state = useCallback(
    (next_filter_state: QualityRuleFilterState<Scope>): void => {
      set_result_snapshot((previous_snapshot) => {
        return previous_snapshot ?? build_result_snapshot(filter_state, sort_state);
      });
      set_filter_state(next_filter_state);
      debounced_result_snapshot.schedule(next_filter_state, sort_state);
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      filter_state,
      set_filter_state,
      set_result_snapshot,
      sort_state,
    ],
  );

  const update_filter_keyword = useCallback(
    (keyword: string): void => update_filter_state({ ...filter_state, keyword }),
    [filter_state, update_filter_state],
  );
  const update_filter_scope = useCallback(
    (scope: Scope): void => update_filter_state({ ...filter_state, scope }),
    [filter_state, update_filter_state],
  );
  const update_filter_regex = useCallback(
    (is_regex: boolean): void => update_filter_state({ ...filter_state, is_regex }),
    [filter_state, update_filter_state],
  );
  const apply_table_sort_state = useCallback(
    (next_table_sort_state: TableSortState): void => {
      const next_sort_state = resolve_sort_state(next_table_sort_state);
      debounced_result_snapshot.cancel();
      set_sort_state(next_sort_state);
      set_result_snapshot(build_result_snapshot(filter_state, next_sort_state));
    },
    [
      build_result_snapshot,
      debounced_result_snapshot,
      filter_state,
      resolve_sort_state,
      set_result_snapshot,
      set_sort_state,
    ],
  );

  return {
    update_filter_keyword,
    update_filter_scope,
    update_filter_regex,
    apply_table_sort_state,
  };
}
