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
  /** 按扫描顺序流式返回命中，避免调用方为计数或分组物化完整结果。 */
  scan: (text: string, visit: (key: string, range: TextRange) => void) => void;
  /** 按 pattern 顺序聚合每个身份的全部原文范围。 */
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

type NormalizedText = {
  text: string;
  starts: number[];
  ends: number[];
};

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 全仓字面量匹配的唯一规范化规则；大小写标志只控制 casefold。 */
export function normalize_literal_text(text: string, case_sensitive: boolean): string {
  const normalized = text.normalize("NFKC");
  return case_sensitive
    ? normalized
    : normalized.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLowerCase().replaceAll("ς", "σ");
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
    sensitive_indexes.map((index) =>
      normalize_literal_text(active_patterns[index]?.text ?? "", true),
    ),
  );
  const insensitive_matcher = build_aho_matcher(
    insensitive_indexes.map((index) =>
      normalize_literal_text(active_patterns[index]?.text ?? "", false),
    ),
  );

  const scan = (text: string, visit: (key: string, range: TextRange) => void): void => {
    const visit_index = (pattern_index: number, range: TextRange): void => {
      const pattern = active_patterns[pattern_index];
      if (pattern !== undefined) visit(pattern.key, range);
    };
    if (sensitive_matcher !== null) {
      collect_matches(
        sensitive_matcher,
        normalize_text_with_source_ranges(text, true),
        sensitive_indexes,
        visit_index,
      );
    }
    if (insensitive_matcher !== null) {
      collect_matches(
        insensitive_matcher,
        normalize_text_with_source_ranges(text, false),
        insensitive_indexes,
        visit_index,
      );
    }
  };

  return {
    patterns: active_patterns,
    scan,
    match(text) {
      const ranges_by_key = new Map<string, TextRange[]>();
      scan(text, (key, range) => {
        const ranges = ranges_by_key.get(key) ?? [];
        ranges.push(range);
        ranges_by_key.set(key, ranges);
      });
      return active_patterns.flatMap((pattern) => {
        const ranges = ranges_by_key.get(pattern.key) ?? [];
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

/** 将规范化坐标回写到原文 UTF-16 范围；同一 grapheme 展开产生的相同范围只保留一次。 */
function collect_matches(
  matcher: AhoMatcher,
  input: NormalizedText,
  bucket_indexes: number[],
  visit: (pattern_index: number, range: TextRange) => void,
): void {
  let node_index = 0;
  const previous_range_by_pattern = new Map<number, TextRange>();
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
      const pattern_index = bucket_indexes[bucket_index];
      if (pattern_index === undefined) continue;
      const previous_range = previous_range_by_pattern.get(pattern_index);
      if (previous_range?.start === start && previous_range.end === end) continue;
      const range = { start, end };
      previous_range_by_pattern.set(pattern_index, range);
      visit(pattern_index, range);
    }
  }
}

/** 规范化每个 grapheme，并保存规范化 UTF-16 坐标到原文 UTF-16 范围的映射。 */
function normalize_text_with_source_ranges(text: string, case_sensitive: boolean): NormalizedText {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    const value = normalize_literal_text(segment.segment, case_sensitive);
    normalized += value;
    for (let index = 0; index < value.length; index += 1) {
      starts.push(start);
      ends.push(end);
    }
  }
  return { text: normalized, starts, ends };
}
