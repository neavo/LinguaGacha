import type { ProjectDataSection, ProjectDataSectionRevisions } from "@shared/project-event";

// 结果快照只保存应用查询和有序 id，页面渲染必须再回读当前事实对象。
export type ResultSnapshot<Query, Id extends string> = {
  applied_query: Query;
  ordered_ids: Id[];
  invalid_message: string | null;
};

export type ResultRefreshPolicy =
  | { kind: "preserve_current_members" }
  | { kind: "rebuild_from_current_source" };

export type ResultSource = {
  projectPath: string;
  section: ProjectDataSection;
  revision: number;
};

export type PendingResultRefresh = {
  policy: ResultRefreshPolicy;
  source: ResultSource;
};

export type ResultSourceCheckpoint = {
  projectPath: string;
  sections: ProjectDataSectionRevisions;
};

export const PRESERVE_RESULT_REFRESH: ResultRefreshPolicy = {
  kind: "preserve_current_members",
};

export const REBUILD_RESULT_REFRESH: ResultRefreshPolicy = {
  kind: "rebuild_from_current_source",
};

// refresh 策略只描述成员集合语义，不承载项目事实或查询条件。
export function should_rebuild_result(policy: ResultRefreshPolicy): boolean {
  return policy.kind === "rebuild_from_current_source";
}

// 成员/顺序变更请求必须绑定项目身份与事实源 revision，避免旧项目 HTTP 回包污染当前项目。
export function create_result_refresh(args: {
  policy: ResultRefreshPolicy;
  source: ResultSource;
}): PendingResultRefresh | null {
  if (!should_rebuild_result(args.policy)) {
    return null;
  }

  return {
    policy: args.policy,
    source: args.source,
  };
}

// 只有当前事实源已经到达目标 revision，页面才能用最新 canonical 数据重建结果成员。
export function is_result_refresh_ready(args: {
  request: PendingResultRefresh | null;
  current_source_checkpoint: ResultSourceCheckpoint;
}): boolean {
  if (args.request === null) {
    return false;
  }

  if (args.current_source_checkpoint.projectPath !== args.request.source.projectPath) {
    return false;
  }

  const current_source_revision =
    args.current_source_checkpoint.sections[args.request.source.section] ?? 0;
  return current_source_revision >= args.request.source.revision;
}

// 用户显式触发查询类 action 时创建新快照，避免后续事实刷新偷偷改变结果成员。
export function create_result_snapshot<Query, Id extends string>(args: {
  applied_query: Query;
  ordered_ids: Id[];
  invalid_message?: string | null;
}): ResultSnapshot<Query, Id> {
  return {
    applied_query: args.applied_query,
    ordered_ids: [...args.ordered_ids],
    invalid_message: args.invalid_message ?? null,
  };
}

// 删除或整体数据源收缩属于结构性失效，只剪除已不存在的实体 id。
export function prune_result_snapshot<Query, Id extends string>(
  snapshot: ResultSnapshot<Query, Id>,
  valid_id_set: ReadonlySet<Id>,
): ResultSnapshot<Query, Id> {
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

// 统一协调“事实源变化后结果快照如何对齐”，避免各页面各自猜新增、删除和刷新语义。
export function reconcile_result_snapshot<Query, Id extends string>(args: {
  previous_snapshot: ResultSnapshot<Query, Id> | null;
  current_snapshot: ResultSnapshot<Query, Id>;
  valid_id_set: ReadonlySet<Id>;
  refresh_policy?: ResultRefreshPolicy;
}): ResultSnapshot<Query, Id> {
  const refresh_policy = args.refresh_policy ?? PRESERVE_RESULT_REFRESH;
  if (args.previous_snapshot === null || should_rebuild_result(refresh_policy)) {
    return args.current_snapshot;
  }

  return prune_result_snapshot(args.previous_snapshot, args.valid_id_set);
}

// 快照落地展示时只按 id 取当前对象，不保留旧整行内容。
export function materialize_result_snapshot<Query, Id extends string, Item>(args: {
  snapshot: ResultSnapshot<Query, Id>;
  item_by_id: ReadonlyMap<Id, Item>;
}): Item[] {
  return args.snapshot.ordered_ids.flatMap((id) => {
    const item = args.item_by_id.get(id);
    return item === undefined ? [] : [item];
  });
}
