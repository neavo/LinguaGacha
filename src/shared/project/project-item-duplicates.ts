import type { ItemStatus } from "../../domain/item";

/** 重复协调只依赖稳定身份、同文组键和当前状态。 */
export type ProjectDuplicateItem = Readonly<{
  item_id: number; // 稳定条目身份与同一行号下的排序后备
  file_path: string; // 重复关系不跨文件
  row_number: number; // 文件内代表项排序
  src: string; // 完全相同的原文组成重复组
  status: ItemStatus; // 当前权威状态
}>;

export type ProjectDuplicateStatusChange = Readonly<{
  item_id: number; // 实际需要改写的条目
  status: "NONE" | "DUPLICATED"; // 协调器拥有的两个状态
}>;

type DuplicateGroup = {
  candidates: ProjectDuplicateItem[]; // 可在 NONE 与 DUPLICATED 间协调的成员
  has_anchor: boolean; // PROCESSED 或 ERROR 已承担组代表
};

/**
 * 同文件同原文只保留一个可翻译代表；已完成或最终失败的条目承担组代表，避免重复请求绕过重试语义。
 * 协调器只维护 NONE 与 DUPLICATED，不覆盖人工、过滤或任务产生的其它状态。
 */
export function coordinate_project_duplicate_statuses(
  items: readonly ProjectDuplicateItem[],
  enabled: boolean,
  affected_item_ids?: ReadonlySet<number>,
): ProjectDuplicateStatusChange[] {
  const affected_group_keys =
    affected_item_ids === undefined
      ? null
      : new Set(
          items
            .filter((item) => affected_item_ids.has(item.item_id))
            .map((item) => duplicate_group_key(item.file_path, item.src)),
        );
  const groups_by_file = new Map<string, Map<string, DuplicateGroup>>();
  for (const item of items) {
    if (
      affected_group_keys !== null &&
      !affected_group_keys.has(duplicate_group_key(item.file_path, item.src))
    ) {
      continue;
    }
    let groups_by_src = groups_by_file.get(item.file_path);
    if (groups_by_src === undefined) {
      groups_by_src = new Map<string, DuplicateGroup>();
      groups_by_file.set(item.file_path, groups_by_src);
    }
    let group = groups_by_src.get(item.src);
    if (group === undefined) {
      group = { candidates: [], has_anchor: false };
      groups_by_src.set(item.src, group);
    }
    if (item.status === "NONE" || item.status === "DUPLICATED") {
      group.candidates.push(item);
    } else if (item.status === "PROCESSED" || item.status === "ERROR") {
      group.has_anchor = true;
    }
  }

  const changes: ProjectDuplicateStatusChange[] = [];
  for (const groups_by_src of groups_by_file.values()) {
    for (const group of groups_by_src.values()) {
      group.candidates.sort(
        (left, right) => left.row_number - right.row_number || left.item_id - right.item_id,
      );
      for (const [index, item] of group.candidates.entries()) {
        const status: "NONE" | "DUPLICATED" =
          !enabled || (!group.has_anchor && index === 0) ? "NONE" : "DUPLICATED";
        if (item.status !== status) changes.push({ item_id: item.item_id, status });
      }
    }
  }
  return changes;
}

/** 使用不可出现在路径中的 NUL 分隔组键，避免字符串拼接歧义。 */
function duplicate_group_key(file_path: string, src: string): string {
  return `${file_path}\u0000${src}`;
}
