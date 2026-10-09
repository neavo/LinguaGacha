import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useProjectSessionTableUiState,
  type ProjectSessionUiStateKey,
} from "@frontend/app/session/project-session-ui-state-context";
import { useResultSnapshotState } from "@frontend/app/result/hook";
import { create_result_snapshot, materialize_result_snapshot } from "@frontend/app/result/snapshot";
import { useDebouncedCallback } from "@frontend/widgets/interactions/use-debounce";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";
import { has_active_quality_rule_filters } from "./quality-rule-filtering";
import {
  can_reorder_quality_rule_entries,
  are_quality_rule_entry_ids_equal,
} from "./quality-rule-selection";
import type { QualityRuleVisibleEntry } from "./quality-rule-filtering";
import type { QualityRuleStatisticsCacheSnapshot } from "@frontend/app/session/quality-rule-statistics-store";
type Filter<Scope extends string = string> = { keyword: string; scope: Scope; is_regex: boolean };
/** 表格会话以空值表示未排序。 */
const empty_sort = (): AppTableSortState | null => null;
/** 复制轻量筛选字段，隔离会话保存值。 */
function clone_filter<F extends Filter>(filter: F): F {
  return { ...filter };
}

/** 表格只缓存查询结果成员和交互状态，行内容始终来自当前规则快照。 */
export function useQualityRuleTable<E extends { entry_id: string }, Scope extends string>(options: {
  key: ProjectSessionUiStateKey;
  project_path: string;
  section_revision: number;
  loaded: boolean;
  readonly: boolean;
  entries: E[];
  create_filter: () => Filter<Scope>;
  sort_columns: ReadonlySet<string>;
  statistics: QualityRuleStatisticsCacheSnapshot;
  build_result: (
    filter: Filter<Scope>,
    sort: AppTableSortState | null,
  ) => { visible_entries: QualityRuleVisibleEntry<E>[]; invalid_regex_message: string | null };
}) {
  type F = Filter<Scope>;
  const { project_path, section_revision, entries, sort_columns, build_result } = options;
  /** 恢复排序时只接受本页已有列。 */
  const normalize_sort = useCallback(
    (sort: AppTableSortState | null) =>
      sort !== null && sort_columns.has(sort.column_id) ? sort : null,
    [sort_columns],
  );
  const session = useProjectSessionTableUiState<F, AppTableSortState | null>({
    key: options.key,
    create_default_filter_state: options.create_filter,
    create_default_sort_state: empty_sort,
    clone_filter_state: clone_filter,
    normalize_sort_state: normalize_sort,
  });
  const { filter_state, sort_state, set_filter_state, set_sort_state } = session;
  const entry_ids = useMemo(() => entries.map((entry) => entry.entry_id), [entries]);
  const entry_index_by_id = useMemo(
    () => new Map(entry_ids.map((id, index) => [id, index])),
    [entry_ids],
  );
  /** 将业务筛选结果转换为稳定身份快照。 */
  const build_result_snapshot = useCallback(
    (filter: Filter<Scope>, sort: AppTableSortState | null) => {
      const result = build_result(filter, sort);
      return create_result_snapshot({
        applied_query: { filter_state: filter, sort_state: sort },
        ordered_ids: result.visible_entries.map((row) => row.entry_id),
        invalid_message: result.invalid_regex_message,
      });
    },
    [build_result],
  );
  /** 使用当前控件条件建立结果快照。 */
  const build_current = useCallback(
    () => build_result_snapshot(filter_state, sort_state),
    [build_result_snapshot, filter_state, sort_state],
  );
  const has_active_filters = has_active_quality_rule_filters(filter_state);
  const {
    result_snapshot,
    set_result_snapshot,
    set_pending_result_refresh,
    reset_result_snapshot,
  } = useResultSnapshotState({
    loaded: options.loaded,
    project_path,
    section: "quality",
    section_revision,
    has_active_query: has_active_filters,
    valid_ids: entry_ids,
    build_snapshot: build_current,
  });
  const debounced = useDebouncedCallback((filter: Filter<Scope>, sort: AppTableSortState | null) =>
    set_result_snapshot(build_result_snapshot(filter, sort)),
  );
  // 读取期间修改控件后，旧防抖参数不能在新数据到达时重新应用。
  useEffect(() => {
    if (!options.loaded) debounced.cancel();
  }, [debounced, options.loaded]);
  const current_result = useMemo(
    () => build_result(filter_state, sort_state),
    [build_result, filter_state, sort_state],
  );
  const filtered_entries = useMemo(
    () =>
      result_snapshot === null
        ? current_result.visible_entries
        : materialize_result_snapshot({
            snapshot: result_snapshot,
            item_by_id: new Map(
              entries.map((entry, source_index) => [
                entry.entry_id,
                { entry, entry_id: entry.entry_id, source_index },
              ]),
            ),
          }),
    [current_result.visible_entries, entries, result_snapshot],
  );
  const visible_entry_ids = useMemo(
    () => filtered_entries.map((row) => row.entry_id),
    [filtered_entries],
  );
  const visible_ids = useMemo(() => new Set(visible_entry_ids), [visible_entry_ids]);
  const { selected_row_ids, active_row_id, anchor_row_id, set_selection_state, reset_table_state } =
    session;
  const previous_project = useRef(project_path); // 结果修订由 app/result 处理，表格会话负责交互状态。
  useEffect(() => {
    // 首次挂载先释放空结果，避免加载完成前清掉恢复的选区。
    reset_result_snapshot();
    if (previous_project.current === project_path) return;
    previous_project.current = project_path;
    reset_table_state({ persist: false });
  }, [project_path, reset_result_snapshot, reset_table_state]);

  // 只保留仍可见的选区与锚点，列表内容来自当前规则快照。
  useEffect(() => {
    if (!options.loaded) return;
    const selected = selected_row_ids.filter((id) => visible_ids.has(id));
    const active = active_row_id !== null && visible_ids.has(active_row_id) ? active_row_id : null;
    const anchor = anchor_row_id !== null && visible_ids.has(anchor_row_id) ? anchor_row_id : null;
    if (
      are_quality_rule_entry_ids_equal(selected_row_ids, selected) &&
      active === active_row_id &&
      anchor === anchor_row_id
    )
      return;
    set_selection_state({
      selected_row_ids: selected,
      active_row_id: active,
      anchor_row_id: anchor,
    });
  }, [
    options.loaded,
    selected_row_ids,
    active_row_id,
    anchor_row_id,
    visible_ids,
    set_selection_state,
  ]);

  // 统计只改变展示顺序，保留筛选成员和用户的排序意图。
  const previous_statistics = useRef(options.statistics);
  useEffect(() => {
    if (previous_statistics.current === options.statistics) return;
    previous_statistics.current = options.statistics;
    if (sort_state?.column_id !== "hit") return;
    set_result_snapshot((previous) => {
      if (previous === null) return previous;
      const members = new Set(previous.ordered_ids);
      const result = build_result(
        { ...previous.applied_query.filter_state, keyword: "" },
        sort_state,
      );
      return {
        ...previous,
        ordered_ids: result.visible_entries
          .filter((row) => members.has(row.entry_id))
          .map((row) => row.entry_id),
      };
    });
  }, [options.statistics, build_result, set_result_snapshot, sort_state]);
  /** 输入立即更新控件，结果成员在防抖完成时更新。 */
  const update_filter = useCallback(
    (filter: F): void => {
      if (!options.loaded) {
        set_filter_state(filter);
        return;
      }
      set_result_snapshot(
        (previous) => previous ?? build_result_snapshot(filter_state, sort_state),
      );
      set_filter_state(filter);
      debounced.schedule(filter, sort_state);
    },
    [
      options.loaded,
      build_result_snapshot,
      debounced,
      filter_state,
      set_filter_state,
      set_result_snapshot,
      sort_state,
    ],
  );
  /** 显式排序取消待执行筛选，并使用当前完整查询。 */
  const apply_table_sort_state = useCallback(
    (sort: AppTableSortState | null): void => {
      const next = normalize_sort(sort);
      debounced.cancel();
      set_sort_state(next);
      set_result_snapshot(build_result_snapshot(filter_state, next));
    },
    [
      build_result_snapshot,
      debounced,
      filter_state,
      normalize_sort,
      set_result_snapshot,
      set_sort_state,
    ],
  );
  /** 关系查询等显式操作立即应用筛选并取消防抖。 */
  const apply_filter = useCallback(
    (filter: Filter<Scope>, sort: AppTableSortState | null) => {
      debounced.cancel();
      set_filter_state(filter);
      set_sort_state(sort);
      set_result_snapshot(build_result_snapshot(filter, sort));
    },
    [build_result_snapshot, debounced, set_filter_state, set_sort_state, set_result_snapshot],
  );
  /** 空列表尚未就绪时，忽略表格回调以保留待恢复的选区。 */
  const apply_table_selection = useCallback(
    (payload: Parameters<typeof session.set_selection_state>[0]) => {
      if (options.loaded) session.set_selection_state(payload);
    },
    [options.loaded, session.set_selection_state],
  );
  return {
    update_filter_keyword: (keyword: string) => update_filter({ ...filter_state, keyword }),
    update_filter_scope: (scope: Scope) => update_filter({ ...filter_state, scope }),
    update_filter_regex: (is_regex: boolean) => update_filter({ ...filter_state, is_regex }),
    apply_table_sort_state,
    session,
    entry_ids,
    entry_index_by_id,
    filter_state,
    sort_state,
    filtered_entries,
    invalid_filter_message:
      result_snapshot?.invalid_message ?? current_result.invalid_regex_message,
    set_pending_result_refresh,
    apply_filter,
    selected_entry_ids: session.selected_row_ids,
    active_entry_id: session.active_row_id,
    selection_anchor_entry_id: session.anchor_row_id,
    restore_scroll_entry_id: session.restore_scroll_row_id,
    apply_table_selection,
    reorder_disabled: !can_reorder_quality_rule_entries({
      readonly: options.readonly,
      has_active_query: has_active_filters || sort_state !== null,
      visible_entry_ids,
      ordered_entry_ids: entry_ids,
    }),
  };
}
