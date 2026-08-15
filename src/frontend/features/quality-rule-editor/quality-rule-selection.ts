import {
  build_app_table_reordered_row_ids,
  resolve_app_table_drag_group_row_ids,
} from "@frontend/widgets/app-table/app-table-dnd";

type QualityRuleBooleanMenuState = "enabled" | "disabled" | "mixed";

/**
 * 选区顺序也是表格交互状态的一部分，因此按位置而非集合比较。
 */
export function are_quality_rule_entry_ids_equal(
  left_entry_ids: readonly string[],
  right_entry_ids: readonly string[],
): boolean {
  return (
    left_entry_ids === right_entry_ids ||
    (left_entry_ids.length === right_entry_ids.length &&
      left_entry_ids.every((entry_id, index) => entry_id === right_entry_ids[index]))
  );
}

/** 新条目跟随活动行；活动行失效时回退到最后一个仍存在的选中行。 */
export function resolve_quality_rule_insert_after_entry_id<Id extends string>(
  active_entry_id: Id | null,
  selected_entry_ids: readonly Id[],
  valid_entry_ids: { has: (entry_id: Id) => boolean },
): Id | null {
  if (active_entry_id !== null && valid_entry_ids.has(active_entry_id)) {
    return active_entry_id;
  }

  return selected_entry_ids.findLast((entry_id) => valid_entry_ids.has(entry_id)) ?? null;
}

/** 汇总批量目标的布尔规则状态，供菜单呈现选中、未选中或混合态。 */
export function resolve_quality_rule_boolean_menu_state<Entry, Id extends string>(args: {
  entry_by_id: ReadonlyMap<Id, Entry>;
  target_entry_ids: readonly Id[];
  pick_value: (entry: Entry) => boolean;
}): QualityRuleBooleanMenuState {
  let common_value: boolean | undefined;

  for (const entry_id of args.target_entry_ids) {
    const target_entry = args.entry_by_id.get(entry_id);
    if (target_entry === undefined) {
      continue;
    }
    const value = args.pick_value(target_entry);
    if (common_value !== undefined && common_value !== value) {
      return "mixed";
    }
    common_value = value;
  }

  return common_value === undefined ? "mixed" : common_value ? "enabled" : "disabled";
}

/**
 * 拖动选中组时保持组内原顺序，并按拖动方向插入目标行前后。
 */
export function reorder_selected_quality_rule_entries<Entry>(
  entries: Entry[],
  ordered_entry_ids: readonly string[],
  selected_entry_ids: readonly string[],
  active_entry_id: string,
  over_entry_id: string,
): Entry[] {
  const moving_entry_ids = resolve_app_table_drag_group_row_ids({
    selection_mode: "multiple",
    active_row_id: active_entry_id,
    selected_row_ids: [...selected_entry_ids],
  });
  const reordered_entry_ids = build_app_table_reordered_row_ids({
    ordered_row_ids: [...ordered_entry_ids],
    moving_row_ids: moving_entry_ids,
    over_row_id: over_entry_id,
  });
  const entry_by_id = new Map(
    ordered_entry_ids.map((entry_id, index) => [entry_id, entries[index]]),
  );

  return reordered_entry_ids.map((entry_id) => entry_by_id.get(entry_id)!);
}
