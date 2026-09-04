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

/** 查询控件与防抖结果可能短暂错位，仅在可见结果完整反映权威顺序时开放重排。 */
export function can_reorder_quality_rule_entries(args: {
  readonly: boolean;
  has_active_query: boolean;
  visible_entry_ids: readonly string[];
  ordered_entry_ids: readonly string[];
}): boolean {
  return (
    !args.readonly &&
    !args.has_active_query &&
    are_quality_rule_entry_ids_equal(args.visible_entry_ids, args.ordered_entry_ids)
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

/** 按表格已经裁决的最终身份顺序投影规则条目。 */
export function order_quality_rule_entries_by_id<Entry>(
  entries: Entry[],
  current_entry_ids: readonly string[],
  ordered_entry_ids: readonly string[],
): Entry[] {
  const entry_by_id = new Map(
    current_entry_ids.map((entry_id, index) => [entry_id, entries[index]]),
  );

  return ordered_entry_ids.map((entry_id) => entry_by_id.get(entry_id)!);
}
