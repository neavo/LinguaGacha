import { normalize_literal_text } from "@lg/text";

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const MIN_ROOT_LENGTH = 2; // 单字符重合噪声过大
const MIN_ROOT_COVERAGE = 0.5; // 候选片段至少覆盖成员词形的一半
/** 字素边界避免把组合字符或表情内部的字符当成独立关系。 */
const segments = (text) => [...SEGMENTER.segment(text)].map((part) => part.segment);

/** 分析完整对象集合。字符关系只提供调查线索，所有关系直接引用输入 ID。 */
export function analyzeRelations(entries) {
  const ids = new Set();
  const sensitive = new Map();
  const insensitive = new Map();
  entries.forEach((entry, index) => {
    if (!entry.id?.trim() || !entry.src?.trim() || typeof entry.case_sensitive !== "boolean")
      throw new Error("Expected an entry id, nonblank src and case_sensitive");
    if (ids.has(entry.id)) throw new Error(`Duplicate id: ${entry.id}`);
    ids.add(entry.id);
    const bucket = entry.case_sensitive ? sensitive : insensitive;
    const text = normalize_literal_text(entry.src, entry.case_sensitive);
    const indexes = bucket.get(text) ?? [];
    indexes.push(index);
    bucket.set(text, indexes);
  });

  // 以被包含者的大小写策略查完整字素片段，沿用正式规范化并避免拆开组合字符。
  const pairs = new Map();
  entries.forEach((entry, parent) => {
    for (const [case_sensitive, bucket] of [
      [true, sensitive],
      [false, insensitive],
    ]) {
      const chars = segments(normalize_literal_text(entry.src, case_sensitive));
      for (let start = 0; start < chars.length; start += 1) {
        let text = "";
        for (let end = start; end < chars.length; end += 1) {
          text += chars[end];
          for (const child of bucket.get(text) ?? []) {
            if (child === parent) continue;
            const low = Math.min(parent, child);
            const high = Math.max(parent, child);
            const key = `${low}:${high}`;
            const equivalent = start === 0 && end + 1 === chars.length;
            if (!pairs.has(key) || equivalent) {
              pairs.set(key, {
                reason: equivalent ? "equivalent" : "contains",
                entry_ids: equivalent
                  ? [entries[low].id, entries[high].id]
                  : [entry.id, entries[child].id],
              });
            }
          }
        }
      }
    }
  });

  // 公共片段独立提供成员线索，不传递关系、不安排互斥审查组，也不按组大小丢弃成员。
  const roots = new Map();
  entries.forEach((entry, index) => {
    const chars = segments(normalize_literal_text(entry.src, false));
    const seen = new Set();
    for (let start = 0; start < chars.length; start += 1) {
      let root = "";
      for (let end = start; end < chars.length; end += 1) {
        root += chars[end];
        const length = end - start + 1;
        if (
          length < MIN_ROOT_LENGTH ||
          length / chars.length < MIN_ROOT_COVERAGE ||
          !root.trim() ||
          seen.has(root)
        )
          continue;
        seen.add(root);
        const candidate = roots.get(root) ?? { root, length, indexes: [] };
        candidate.indexes.push(index);
        roots.set(root, candidate);
      }
    }
  });
  // 相同成员集合只保留最长片段，等长时保留输入顺序下最先发现的片段。
  const byMembers = new Map();
  for (const candidate of roots.values()) {
    if (candidate.indexes.length < 2) continue;
    const key = candidate.indexes.join(",");
    const previous = byMembers.get(key);
    if (!previous || candidate.length > previous.length) byMembers.set(key, candidate);
  }
  return {
    entry_ids: entries.map((entry) => entry.id), // 孤立对象也保留在完整分析范围内
    relations: [
      ...pairs.values(),
      ...[...byMembers.values()].map(({ root, indexes }) => ({
        reason: "shared_root",
        root,
        entry_ids: indexes.map((index) => entries[index].id),
      })),
    ],
  };
}
