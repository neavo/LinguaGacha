// 结果视图快照只保存应用查询和有序 id，页面渲染必须再回读当前事实对象
export type ResultViewSnapshot<Query, Id extends string> = {
  applied_query: Query;
  ordered_ids: Id[];
  invalid_message: string | null;
};

// 用户显式触发查询类 action 时创建新快照，避免后续事实刷新偷偷改变结果成员
export function create_result_view_snapshot<Query, Id extends string>(args: {
  applied_query: Query;
  ordered_ids: Id[];
  invalid_message?: string | null;
}): ResultViewSnapshot<Query, Id> {
  return {
    applied_query: args.applied_query,
    ordered_ids: [...args.ordered_ids],
    invalid_message: args.invalid_message ?? null,
  };
}

// 删除或整体数据源收缩属于结构性失效，只剪除已不存在的实体 id
export function prune_result_view_snapshot<Query, Id extends string>(
  snapshot: ResultViewSnapshot<Query, Id>,
  valid_id_set: ReadonlySet<Id>,
): ResultViewSnapshot<Query, Id> {
  const ordered_ids = snapshot.ordered_ids.filter((id) => {
    return valid_id_set.has(id);
  });

  if (ordered_ids.length === snapshot.ordered_ids.length) {
    return snapshot;
  }

  return {
    ...snapshot,
    ordered_ids,
  };
}

// 快照落地展示时只按 id 取当前对象，不保留旧整行内容
export function materialize_result_view_snapshot<Query, Id extends string, Item>(args: {
  snapshot: ResultViewSnapshot<Query, Id>;
  item_by_id: ReadonlyMap<Id, Item>;
}): Item[] {
  return args.snapshot.ordered_ids.flatMap((id) => {
    const item = args.item_by_id.get(id);
    return item === undefined ? [] : [item];
  });
}
