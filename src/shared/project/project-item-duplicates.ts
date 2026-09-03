import type { ItemNameField, ItemStatus, ItemTextType } from "../../domain/item";
import { read_optional_item_name_text } from "../item-name";

/** 重复关系由文件范围、正文和翻译实际使用的角色名与文本规则共同决定。 */
export type ProjectItemDuplicateIdentity = Readonly<{
  file_path: string; // 重复关系不跨文件
  src: string; // 完全相同的正文
  name_src: ItemNameField; // 翻译管线只消费可见姓名槽位
  text_type: ItemTextType; // 文本预处理规则身份
}>;

/** 重复协调只依赖稳定身份、重复组键和当前状态。 */
export type ProjectDuplicateItem = ProjectItemDuplicateIdentity &
  Readonly<{
    item_id: number; // 稳定条目身份与同一行号下的排序后备
    row_number: number; // 文件内代表项排序
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
 * 每个重复组只保留一个可翻译代表；已完成或最终失败的条目承担组代表，避免重复请求绕过重试语义。
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
            .map(build_project_item_duplicate_key),
        );
  const groups = new Map<string, DuplicateGroup>();
  for (const item of items) {
    const key = build_project_item_duplicate_key(item);
    if (affected_group_keys !== null && !affected_group_keys.has(key)) {
      continue;
    }
    let group = groups.get(key);
    if (group === undefined) {
      group = { candidates: [], has_anchor: false };
      groups.set(key, group);
    }
    if (item.status === "NONE" || item.status === "DUPLICATED") {
      group.candidates.push(item);
    } else if (item.status === "PROCESSED" || item.status === "ERROR") {
      group.has_anchor = true;
    }
  }

  const changes: ProjectDuplicateStatusChange[] = [];
  for (const group of groups.values()) {
    group.candidates.sort(
      (left, right) => left.row_number - right.row_number || left.item_id - right.item_id,
    );
    for (const [index, item] of group.candidates.entries()) {
      const status: "NONE" | "DUPLICATED" =
        !enabled || (!group.has_anchor && index === 0) ? "NONE" : "DUPLICATED";
      if (item.status !== status) changes.push({ item_id: item.item_id, status });
    }
  }
  return changes;
}

/**
 * 构造预过滤、项目写入和导出共用的重复身份；姓名使用翻译管线实际消费的可见槽位。
 */
export function build_project_item_duplicate_key(item: ProjectItemDuplicateIdentity): string {
  return JSON.stringify([
    item.file_path,
    item.src,
    read_optional_item_name_text(item.name_src),
    item.text_type,
  ]);
}
