const REGEX_FLAGS = "giu"; // 与保护规则一致，每条表达式独立按原文行扫描

/** 扫描原始 item.src，各规则独立取证以暴露零长度和重叠问题。不会裁决保护资格。 */
export async function scanPatterns(items, { patterns, max_matches_per_pattern }) {
  if (
    max_matches_per_pattern !== undefined &&
    (!Number.isSafeInteger(max_matches_per_pattern) || max_matches_per_pattern < 0)
  )
    throw new Error("Invalid evidence limit");
  const limit = max_matches_per_pattern ?? Infinity;
  const keys = new Set();
  const compiled = patterns.map(({ key, source }) => {
    if (!key?.trim() || typeof source !== "string")
      throw new Error("Expected a pattern key and source");
    if (keys.has(key)) throw new Error(`Duplicate key: ${key}`);
    keys.add(key);
    let regex = null;
    let error = null;
    try {
      regex = new RegExp(source, REGEX_FLAGS);
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
      error = cause.message; // 编译失败是本次调查结果，其余候选仍需完整取证。
    }
    return {
      regex,
      files: new Map(),
      textTypes: new Map(),
      result: {
        key,
        source,
        error,
        match_count: 0,
        matched_item_count: 0,
        zero_length_match_count: 0,
        matches: [],
      },
    };
  });
  let scanned_item_count = 0;
  for await (const item of items) {
    scanned_item_count += 1;
    const lines = item.src.split("\n");
    for (const { regex, result, files, textTypes } of compiled) {
      if (!regex) continue;
      let matched = false;
      for (const [index, line] of lines.entries()) {
        // matchAll 使用独立游标并按 Unicode 前进，逐行扫描与零长度命中都不会复用上次位置。
        for (const match of line.matchAll(regex)) {
          matched = true;
          result.match_count += 1;
          if (match[0].length === 0) result.zero_length_match_count += 1;
          files.set(item.file_path, (files.get(item.file_path) ?? 0) + 1);
          textTypes.set(item.text_type, (textTypes.get(item.text_type) ?? 0) + 1);
          if (result.matches.length < limit)
            result.matches.push({
              item_id: item.item_id,
              file_path: item.file_path,
              text_type: item.text_type,
              line: index + 1,
              start: match.index,
              end: match.index + match[0].length,
              text: match[0],
            });
        }
      }
      if (matched) result.matched_item_count += 1;
    }
  }
  return {
    scanned_item_count,
    patterns: compiled.map(({ result, files, textTypes }) => ({
      ...result,
      matches_complete: result.error === null && result.matches.length === result.match_count,
      file_counts: Object.fromEntries(files),
      text_type_counts: Object.fromEntries(textTypes),
    })),
  };
}
