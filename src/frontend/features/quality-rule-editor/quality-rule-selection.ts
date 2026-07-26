import { build_legacy_quality_rule_entry_id } from "@shared/quality/quality-rule-entry-id";

type QualityRuleEntry = {
  entry_id?: string;
  src?: unknown;
};

/**
 * 新载荷优先使用稳定 entry_id，旧载荷继续沿用共享兼容 ID 规则。
 */
export function resolve_quality_rule_entry_id(entry: QualityRuleEntry, index: number): string {
  return typeof entry.entry_id === "string" && entry.entry_id !== ""
    ? entry.entry_id
    : build_legacy_quality_rule_entry_id(entry, index);
}

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
  const selected_id_set = new Set(
    selected_entry_ids.includes(active_entry_id) ? selected_entry_ids : [active_entry_id],
  );
  const indexed_entries = ordered_entry_ids.map((entry_id, index) => ({
    entry_id,
    entry: entries[index],
  }));
  const moving_entries = indexed_entries.filter((item) => selected_id_set.has(item.entry_id));

  if (moving_entries.length === 0 || selected_id_set.has(over_entry_id)) {
    return entries;
  }

  const remaining_entries = indexed_entries.filter((item) => !selected_id_set.has(item.entry_id));
  const over_entry_index = ordered_entry_ids.indexOf(over_entry_id);
  const insert_index = remaining_entries.findIndex((item) => item.entry_id === over_entry_id);
  let last_moving_index = -1;

  // 向下拖动时目标行已经因移除选中组而前移，需要插入到目标之后。
  for (let index = ordered_entry_ids.length - 1; index >= 0; index -= 1) {
    const entry_id = ordered_entry_ids[index];
    if (entry_id !== undefined && selected_id_set.has(entry_id)) {
      last_moving_index = index;
      break;
    }
  }

  const normalized_insert_index =
    insert_index < 0
      ? remaining_entries.length
      : insert_index + (over_entry_index > last_moving_index ? 1 : 0);

  remaining_entries.splice(normalized_insert_index, 0, ...moving_entries);
  return remaining_entries.map((item) => item.entry);
}
