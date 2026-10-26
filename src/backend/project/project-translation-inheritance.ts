import {
  normalize_item_name_field,
  type ItemStatus,
  type ProjectItemPublicRecord,
} from "../../domain/item";
import { read_item_name_text, read_optional_item_name_text } from "../../shared/item-name";

/** 继承只读取原文身份与译文结果，只改写新条目的译文和完成状态。 */
export type TranslationInheritanceItem = Pick<
  ProjectItemPublicRecord,
  "file_path" | "src" | "name_src" | "dst" | "name_dst" | "status"
>;

type ContextEntry = {
  item: TranslationInheritanceItem;
  source_id: number; // `src` 与可见 `name_src` 的本次编号。
  context_key: string; // 同文件前一条、自身、后一条的源身份编号。
};
type CompletedEntry = ContextEntry & {
  result_id: number; // `dst` 与可见 `name_dst` 的本次编号。
};
type Vote = { item: TranslationInheritanceItem; count: number }; // 首次出现的完整结果及票数。

// 上下文一致说明是同一句话，被规则或语言过滤的条目也接收旧版译文。
const CONTEXT_INHERIT_STATUSES: ReadonlySet<ItemStatus> = new Set([
  "NONE",
  "DUPLICATED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
]);
// 仅原文相同的证据较弱，过滤结果保持不变。
const TEXT_INHERIT_STATUSES: ReadonlySet<ItemStatus> = new Set(["NONE", "DUPLICATED"]);
const FILE_BOUNDARY = -1; // 编号从 0 开始，文件首尾不会与任何条目混淆。

/**
 * 用导入前的已完成条目为新条目填充译文。
 * 前一条、自身、后一条的原文与可见姓名一致且结果无冲突时优先继承。
 * 精确继承未成功时，符合状态条件的条目按原文与可见姓名票选。
 * 两阶段共用同一份旧快照，新填充的结果不参与匹配与投票。
 */
export function inherit_completed_translations(
  old_items: readonly TranslationInheritanceItem[],
  next_items: readonly TranslationInheritanceItem[],
): void {
  const read_source_id = create_pair_id_reader(); // 旧条目与新条目共用，同一身份得到同一编号。
  const read_result_id = create_pair_id_reader();
  // 窗口先由全部旧条目构造再筛选，提前筛掉未完成条目会改变邻接关系。
  const completed = read_context_entries(old_items, read_source_id).flatMap((entry) =>
    entry.item.status === "PROCESSED"
      ? [
          {
            ...entry,
            result_id: read_result_id(entry.item.dst, read_item_name_text(entry.item.name_dst)),
          },
        ]
      : [],
  );
  const context_candidates = build_context_candidates(completed);
  const text_candidates = build_text_candidates(completed);
  for (const { item, source_id, context_key } of read_context_entries(next_items, read_source_id)) {
    // 上下文冲突或未命中时，普通条目继续票选，被过滤条目保持原状态。
    const candidate =
      (CONTEXT_INHERIT_STATUSES.has(item.status)
        ? context_candidates.get(context_key)?.item
        : undefined) ??
      (TEXT_INHERIT_STATUSES.has(item.status) ? text_candidates.get(source_id) : undefined);
    if (candidate === undefined) continue;
    item.dst = candidate.dst;
    item.name_dst = normalize_item_name_field(candidate.name_dst); // 数组姓名不与旧快照共享。
    item.status = "PROCESSED";
  }
}

/** 每个上下文保留最早候选，出现不同结果后永久记为冲突。 */
function build_context_candidates(
  completed: readonly CompletedEntry[],
): Map<string, CompletedEntry | null> {
  const candidates = new Map<string, CompletedEntry | null>();
  for (const entry of completed) {
    const current = candidates.get(entry.context_key);
    if (current === undefined) candidates.set(entry.context_key, entry);
    else if (current !== null && current.result_id !== entry.result_id)
      candidates.set(entry.context_key, null);
  }
  return candidates;
}

/** 按旧条目全局顺序计票，票数严格更高才替换胜者，同票保留最早结果。 */
function build_text_candidates(
  completed: readonly CompletedEntry[],
): Map<number, TranslationInheritanceItem> {
  const groups = new Map<number, Map<number, Vote>>();
  for (const { item, source_id, result_id } of completed) {
    const results = groups.get(source_id) ?? new Map<number, Vote>();
    const vote = results.get(result_id);
    if (vote === undefined) results.set(result_id, { item, count: 1 });
    else vote.count += 1;
    groups.set(source_id, results);
  }
  return new Map(
    [...groups].map(([source_id, results]) => [
      source_id,
      // `Map` 保留首次插入顺序，严格大于才替换使同票沿用最早结果。
      [...results.values()].reduce((winner, vote) => (vote.count > winner.count ? vote : winner))
        .item,
    ]),
  );
}

/**
 * 按输入顺序返回条目及其上下文。上下文在同一文件内构造，包含空正文与被过滤条目。
 * 上下文键只拼接编号，长原文不会在多个窗口中重复存储。
 */
function read_context_entries(
  items: readonly TranslationInheritanceItem[],
  read_source_id: (text: string, name: string | null) => number,
): ContextEntry[] {
  const entries = items.map((item) => ({
    item,
    source_id: read_source_id(item.src, read_optional_item_name_text(item.name_src)),
    context_key: "",
  }));
  const files = new Map<string, ContextEntry[]>();
  for (const entry of entries) {
    const file_entries = files.get(entry.item.file_path);
    if (file_entries === undefined) files.set(entry.item.file_path, [entry]);
    else file_entries.push(entry);
  }
  for (const file_entries of files.values()) {
    for (const [index, entry] of file_entries.entries()) {
      const previous = file_entries[index - 1]?.source_id ?? FILE_BOUNDARY;
      const next = file_entries[index + 1]?.source_id ?? FILE_BOUNDARY;
      entry.context_key = `${previous},${entry.source_id},${next}`;
    }
  }
  return entries;
}

/**
 * 为（文本, 可见姓名）组合分配仅在本次继承内有效的编号。
 * 嵌套 `Map` 直接以原字符串作键，比较仍是精确相等，长文本也不会被复制。
 */
function create_pair_id_reader(): (text: string, name: string | null) => number {
  const ids = new Map<string, Map<string | null, number>>();
  let next_id = 0;
  return (text, name) => {
    const ids_by_name = ids.get(text) ?? new Map<string | null, number>();
    ids.set(text, ids_by_name);
    const id = ids_by_name.get(name);
    if (id !== undefined) return id;
    ids_by_name.set(name, next_id);
    return next_id++;
  };
}
