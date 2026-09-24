import { compile_literal_patterns } from "@lg/text";

/** 单次扫描正文与姓名。证据上限只限制收集量，完整计数和原文 UTF-16 范围仍按正式匹配器计算。 */
export async function matchLiterals(items, { patterns, max_matches_per_pattern }) {
  if (
    max_matches_per_pattern !== undefined &&
    (!Number.isSafeInteger(max_matches_per_pattern) || max_matches_per_pattern < 0)
  )
    throw new Error("Invalid evidence limit");
  for (const pattern of patterns) {
    if (
      !pattern.key?.trim() ||
      !pattern.text?.trim() ||
      typeof pattern.case_sensitive !== "boolean"
    )
      throw new Error("Expected a pattern key, nonblank text and case_sensitive");
  }
  const max_matches = max_matches_per_pattern ?? Infinity;
  const matcher = compile_literal_patterns(patterns);
  const results = new Map(
    patterns.map(({ key }) => [
      key,
      {
        key,
        matches_complete: true,
        matched_item_count: 0,
        field_item_counts: { src: 0, name_src: 0 },
        matches: [],
      },
    ]),
  );
  let scanned_item_count = 0;
  let matched_item_count = 0;

  for await (const { item_id, src, name_src } of items) {
    scanned_item_count += 1;
    const matched_results = new Set(); // 正文与姓名共同命中只计一个 item。
    for (const [field, text] of [
      ["src", src],
      ["name_src", name_src],
    ]) {
      const evidence_keys = new Set();
      matcher.scan_keys(text, (key) => {
        const result = results.get(key); // 身份来自本次编译的模式集合。
        result.field_item_counts[field] += 1;
        matched_results.add(result);
        if (result.matches.length < max_matches) evidence_keys.add(key);
      });
      // 纯计数、无命中和证据已收齐的字段均无需原文坐标。
      if (evidence_keys.size > 0) {
        for (const { key, ranges } of matcher.match(text, evidence_keys)) {
          results.get(key).matches.push({ item_id, field, ranges });
        }
      }
    }
    if (matched_results.size > 0) matched_item_count += 1;
    for (const result of matched_results) result.matched_item_count += 1;
  }

  for (const result of results.values()) {
    result.matches_complete =
      result.matches.length === result.field_item_counts.src + result.field_item_counts.name_src;
  }
  return { scanned_item_count, matched_item_count, patterns: [...results.values()] };
}
