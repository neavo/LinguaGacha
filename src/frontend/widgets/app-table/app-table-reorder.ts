export type AppTableReorderTarget = "top" | "bottom" | { row_id: string };

/** 所有入口按列表原顺序移动整组，目标行属于移动组时保持原位。 */
export function build_app_table_reordered_row_ids(args: {
  ordered_row_ids: readonly string[];
  moving_row_ids: readonly string[];
  target: AppTableReorderTarget;
}): string[] {
  const moving_row_id_set = new Set(args.moving_row_ids);
  const ordered_moving_row_ids = args.ordered_row_ids.filter((row_id) => {
    return moving_row_id_set.has(row_id);
  });

  const remaining_row_ids = args.ordered_row_ids.filter((row_id) => {
    return !moving_row_id_set.has(row_id);
  });
  const target = args.target;
  let insert_index: number;
  if (target === "top") {
    insert_index = 0;
  } else if (target === "bottom") {
    insert_index = remaining_row_ids.length;
  } else {
    const target_index = remaining_row_ids.indexOf(target.row_id);
    // 落点在移动组内或已消失时保持原序；统一由剩余列表判断。
    if (target_index < 0) return [...args.ordered_row_ids];
    // 向下拖过整组时插到落点之后，向上或组间拖动时插到落点之前。
    const last_moving_index = args.ordered_row_ids.findLastIndex((row_id) =>
      moving_row_id_set.has(row_id),
    );
    insert_index =
      target_index + (args.ordered_row_ids.indexOf(target.row_id) > last_moving_index ? 1 : 0);
  }
  remaining_row_ids.splice(insert_index, 0, ...ordered_moving_row_ids);
  return remaining_row_ids;
}
