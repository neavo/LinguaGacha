export type LiteralPattern = {
  key: string;
  text: string;
  case_sensitive: boolean;
};

export type TextRange = {
  start: number;
  end: number;
};

export type LiteralPatternMatch = {
  key: string;
  ranges: TextRange[];
};

export type LiteralMatcher = {
  readonly patterns: readonly LiteralPattern[];
  match: (text: string) => LiteralPatternMatch[];
};

type AhoNode = {
  next: Map<string, number>;
  fail: number;
  outputs: number[];
};

type AhoMatcher = {
  nodes: AhoNode[];
  pattern_lengths: number[];
};

type FoldedText = {
  text: string;
  starts: number[];
  ends: number[];
};

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 全仓大小写不敏感字面量匹配的唯一折叠规则。 */
export function fold_literal_text(text: string): string {
  return text
    .normalize("NFKC")
    .replaceAll("ẞ", "ss")
    .replaceAll("ß", "ss")
    .toLowerCase()
    .replaceAll("ς", "σ");
}

/** 编译大小写敏感与不敏感字面量；空文本跳过，重复身份直接拒绝。 */
export function compile_literal_patterns(patterns: LiteralPattern[]): LiteralMatcher {
  const keys = new Set<string>();
  for (const pattern of patterns) {
    if (keys.has(pattern.key)) {
      throw new Error(`字面量 pattern key 重复：${pattern.key}`);
    }
    keys.add(pattern.key);
  }

  const active_patterns = patterns.filter((pattern) => pattern.text !== "");
  const sensitive_indexes: number[] = [];
  const insensitive_indexes: number[] = [];
  active_patterns.forEach((pattern, index) => {
    (pattern.case_sensitive ? sensitive_indexes : insensitive_indexes).push(index);
  });
  const sensitive_matcher = build_aho_matcher(
    sensitive_indexes.map((index) => active_patterns[index]?.text ?? ""),
  );
  const insensitive_matcher = build_aho_matcher(
    insensitive_indexes.map((index) => fold_literal_text(active_patterns[index]?.text ?? "")),
  );

  return {
    patterns: active_patterns,
    match(text) {
      const ranges_by_pattern = active_patterns.map((): TextRange[] => []);
      if (sensitive_matcher !== null) {
        collect_matches(
          sensitive_matcher,
          { text, starts: [], ends: [] },
          sensitive_indexes,
          ranges_by_pattern,
        );
      }
      if (insensitive_matcher !== null) {
        collect_matches(
          insensitive_matcher,
          fold_text_with_source_ranges(text),
          insensitive_indexes,
          ranges_by_pattern,
        );
      }
      return active_patterns.flatMap((pattern, index) => {
        const ranges = ranges_by_pattern[index] ?? [];
        return ranges.length === 0 ? [] : [{ key: pattern.key, ranges }];
      });
    },
  };
}

/** 构建 failure link，使一次扫描同时保留后缀规则和重叠命中。 */
function build_aho_matcher(patterns: string[]): AhoMatcher | null {
  if (patterns.length === 0) return null;
  const nodes: AhoNode[] = [{ next: new Map(), fail: 0, outputs: [] }];
  patterns.forEach((pattern, pattern_index) => {
    let node_index = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      const character = pattern[index] ?? "";
      const next_index = nodes[node_index]?.next.get(character);
      if (next_index !== undefined) {
        node_index = next_index;
        continue;
      }
      const created_index = nodes.length;
      nodes[node_index]?.next.set(character, created_index);
      nodes.push({ next: new Map(), fail: 0, outputs: [] });
      node_index = created_index;
    }
    nodes[node_index]?.outputs.push(pattern_index);
  });

  const queue = [...(nodes[0]?.next.values() ?? [])];
  for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
    const node_index = queue[queue_index] ?? 0;
    const node = nodes[node_index];
    if (node === undefined) continue;
    for (const [character, child_index] of node.next) {
      queue.push(child_index);
      let fail_index = node.fail;
      while (fail_index !== 0 && !nodes[fail_index]?.next.has(character)) {
        fail_index = nodes[fail_index]?.fail ?? 0;
      }
      const fallback_index = nodes[fail_index]?.next.get(character) ?? 0;
      const child = nodes[child_index];
      if (child === undefined) continue;
      child.fail = fallback_index;
      child.outputs.push(...(nodes[fallback_index]?.outputs ?? []));
    }
  }
  return { nodes, pattern_lengths: patterns.map((pattern) => pattern.length) };
}

/** 将折叠坐标回写到原文 UTF-16 范围；同一 grapheme 展开产生的相同范围只保留一次。 */
function collect_matches(
  matcher: AhoMatcher,
  input: FoldedText,
  bucket_indexes: number[],
  ranges_by_pattern: TextRange[][],
): void {
  let node_index = 0;
  for (let text_index = 0; text_index < input.text.length; text_index += 1) {
    const character = input.text[text_index] ?? "";
    while (node_index !== 0 && !matcher.nodes[node_index]?.next.has(character)) {
      node_index = matcher.nodes[node_index]?.fail ?? 0;
    }
    node_index = matcher.nodes[node_index]?.next.get(character) ?? 0;
    for (const bucket_index of matcher.nodes[node_index]?.outputs ?? []) {
      const pattern_length = matcher.pattern_lengths[bucket_index] ?? 0;
      const folded_start = text_index - pattern_length + 1;
      const start = input.starts[folded_start] ?? folded_start;
      const end = input.ends[text_index] ?? text_index + 1;
      const ranges = ranges_by_pattern[bucket_indexes[bucket_index] ?? -1];
      const previous_range = ranges?.at(-1);
      if (
        ranges !== undefined &&
        (previous_range === undefined ||
          previous_range.start !== start ||
          previous_range.end !== end)
      ) {
        ranges.push({ start, end });
      }
    }
  }
}

/** 折叠每个 grapheme，并保存折叠 UTF-16 坐标到原文 UTF-16 范围的映射。 */
function fold_text_with_source_ranges(text: string): FoldedText {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    const value = fold_literal_text(segment.segment);
    folded += value;
    for (let index = 0; index < value.length; index += 1) {
      starts.push(start);
      ends.push(end);
    }
  }
  return { text: folded, starts, ends };
}
