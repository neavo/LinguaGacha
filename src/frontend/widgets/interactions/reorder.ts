export type ReorderTarget = "top" | "bottom" | { id: string };

/** 所有入口按列表原顺序移动整组，目标行属于移动组时保持原位。 */
export function move_ordered_ids(args: {
  ordered_ids: readonly string[];
  moving_ids: readonly string[];
  target: ReorderTarget;
}): string[] {
  const moving_id_set = new Set(args.moving_ids);
  const ordered_moving_ids = args.ordered_ids.filter((id) => {
    return moving_id_set.has(id);
  });

  const remaining_ids = args.ordered_ids.filter((id) => {
    return !moving_id_set.has(id);
  });
  const target = args.target;
  let insert_index: number;
  if (target === "top") {
    insert_index = 0;
  } else if (target === "bottom") {
    insert_index = remaining_ids.length;
  } else {
    const target_index = remaining_ids.indexOf(target.id);
    // 落点在移动组内或已消失时保持原序；统一由剩余列表判断。
    if (target_index < 0) return [...args.ordered_ids];
    // 向下拖过整组时插到落点之后，向上或组间拖动时插到落点之前。
    const last_moving_index = args.ordered_ids.findLastIndex((id) => moving_id_set.has(id));
    insert_index = target_index + (args.ordered_ids.indexOf(target.id) > last_moving_index ? 1 : 0);
  }
  remaining_ids.splice(insert_index, 0, ...ordered_moving_ids);
  return remaining_ids;
}
