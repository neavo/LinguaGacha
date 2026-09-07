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
  /** 只判断是否存在任一命中，首个命中后立即停止。 */
  matches: (text: string) => boolean;
  /** 每个命中身份只访问一次；计数与分组无需构造原文坐标。 */
  scan_keys: (text: string, visit: (key: string) => void) => void;
  /** 按扫描顺序流式返回命中及原文范围。 */
  scan: (text: string, visit: (key: string, range: TextRange) => void) => void;
  /** 按 pattern 顺序聚合原文范围；keys 只选择需要收集范围的身份。 */
  match: (text: string, keys?: ReadonlySet<string>) => LiteralPatternMatch[];
};

type AhoNode = {
  next: Map<string, number>;
  fail: number; // 转移失败时回退到最长可匹配后缀。
  outputs: number[]; // 当前节点及后缀命中的桶内模式下标。
};

type AhoMatcher = {
  nodes: AhoNode[];
  pattern_lengths: number[];
};

type NormalizedText = {
  text: string;
  starts: number[]; // 每个规范化 UTF-16 单元对应的原文字素起点。
  ends: number[]; // 每个规范化 UTF-16 单元对应的原文字素终点。
};

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** 全仓字面量匹配的唯一规范化规则；大小写标志只控制 casefold。 */
export function normalize_literal_text(text: string, case_sensitive: boolean): string {
  const normalized = text.normalize("NFKC");
  return case_sensitive ? normalized : fold_literal_text(normalized);
}

/** 在 NFKC 结果上统一德语展开及希腊词尾变体。 */
function fold_literal_text(normalized: string): string {
  return normalized.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLowerCase().replaceAll("ς", "σ");
}

/** 编译大小写敏感与不敏感字面量；空文本跳过，重复身份直接拒绝。 */
export function compile_literal_patterns(patterns: LiteralPattern[]): LiteralMatcher {
  const case_by_key = new Map<string, boolean>();
  for (const pattern of patterns) {
    if (case_by_key.has(pattern.key)) {
      throw new Error(`Duplicate literal pattern key: ${pattern.key}.`);
    }
    case_by_key.set(pattern.key, pattern.case_sensitive);
  }

  const active_patterns = patterns.filter((pattern) => pattern.text !== "");
  const buckets = [true, false].flatMap((case_sensitive) => {
    const indexes = active_patterns.flatMap((pattern, index) =>
      pattern.case_sensitive === case_sensitive ? [index] : [],
    );
    const matcher = build_aho_matcher(
      indexes.map((index) => normalize_literal_text(active_patterns[index]!.text, case_sensitive)),
    );
    return matcher === null ? [] : [{ matcher, indexes, case_sensitive }];
  });

  /** 仅为选中身份涉及的大小写桶构造坐标，两桶共享一次字素分割。 */
  const scan_ranges = (
    text: string,
    visit: (index: number, range: TextRange) => void,
    selected_keys?: ReadonlySet<string>,
  ): void => {
    const selected_modes =
      selected_keys === undefined
        ? undefined
        : new Set([...selected_keys].map((key) => case_by_key.get(key)));
    const selected_buckets =
      selected_modes === undefined
        ? buckets
        : buckets.filter((bucket) => selected_modes.has(bucket.case_sensitive));
    if (selected_buckets.length === 0 || text === "") return;
    const inputs = normalize_text_with_source_ranges(
      text,
      selected_buckets.map((bucket) => bucket.case_sensitive),
    );
    for (const bucket of selected_buckets) {
      collect_matches(
        bucket.matcher,
        inputs.get(bucket.case_sensitive)!,
        bucket.indexes,
        (index) => selected_keys === undefined || selected_keys.has(active_patterns[index]!.key),
        visit,
      );
    }
  };

  return {
    patterns: active_patterns,
    /** 首次命中即结束，不分配原文坐标。 */
    matches(text) {
      return buckets.some(({ matcher, case_sensitive }) =>
        scan_aho_text(matcher, normalize_literal_text(text, case_sensitive), () => true),
      );
    },
    /** 每桶身份去重，全部身份命中后停止扫描该桶。 */
    scan_keys(text, visit) {
      for (const { matcher, indexes, case_sensitive } of buckets) {
        const seen = new Set<number>();
        scan_aho_text(matcher, normalize_literal_text(text, case_sensitive), (index) => {
          if (!seen.has(index)) {
            seen.add(index);
            visit(active_patterns[indexes[index]!]!.key);
          }
          return seen.size === indexes.length;
        });
      }
    },
    /** 流式交付身份和原文范围，供包含关系判断使用。 */
    scan(text, visit) {
      scan_ranges(text, (index, range) => visit(active_patterns[index]!.key, range));
    },
    /** 只聚合实际命中，按输入顺序返回各身份的全部范围。 */
    match(text, selected_keys) {
      const ranges_by_index = new Map<number, TextRange[]>();
      scan_ranges(
        text,
        (index, range) => {
          const ranges = ranges_by_index.get(index) ?? [];
          ranges.push(range);
          ranges_by_index.set(index, ranges);
        },
        selected_keys,
      );
      return [...ranges_by_index]
        .sort(([left], [right]) => left - right)
        .map(([index, ranges]) => ({ key: active_patterns[index]!.key, ranges }));
    },
  };
}

/** 所有消费方式共用规范化文本扫描；访问者返回 true 时提前结束。 */
function scan_aho_text(
  matcher: AhoMatcher,
  text: string,
  visit: (index: number, end: number) => boolean,
): boolean {
  let node_index = 0;
  for (let index = 0; index < text.length; index += 1) {
    node_index = advance_aho_matcher(matcher, node_index, text[index]!);
    for (const output of matcher.nodes[node_index]!.outputs) {
      if (visit(output, index)) return true;
    }
  }
  return false;
}

/** 敏感与不敏感路径共用同一 failure-link 推进规则。 */
function advance_aho_matcher(matcher: AhoMatcher, node_index: number, character: string): number {
  let next_node_index = node_index;
  while (next_node_index !== 0 && !matcher.nodes[next_node_index]!.next.has(character)) {
    next_node_index = matcher.nodes[next_node_index]!.fail;
  }
  return matcher.nodes[next_node_index]!.next.get(character) ?? 0;
}

/** 节点下标只由本构造器产生，转移和 failure link 始终指向已存在节点。 */
function build_aho_matcher(patterns: string[]): AhoMatcher | null {
  if (patterns.length === 0) return null;
  const nodes: AhoNode[] = [{ next: new Map(), fail: 0, outputs: [] }];
  patterns.forEach((pattern, pattern_index) => {
    let node_index = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      const character = pattern[index]!;
      const next_index = nodes[node_index]!.next.get(character);
      if (next_index !== undefined) {
        node_index = next_index;
        continue;
      }
      const created_index = nodes.length;
      nodes[node_index]!.next.set(character, created_index);
      nodes.push({ next: new Map(), fail: 0, outputs: [] });
      node_index = created_index;
    }
    nodes[node_index]!.outputs.push(pattern_index);
  });

  const queue = [...nodes[0]!.next.values()];
  for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
    const node = nodes[queue[queue_index]!]!;
    for (const [character, child_index] of node.next) {
      queue.push(child_index);
      let fail_index = node.fail;
      while (fail_index !== 0 && !nodes[fail_index]!.next.has(character)) {
        fail_index = nodes[fail_index]!.fail;
      }
      const fallback_index = nodes[fail_index]!.next.get(character) ?? 0;
      const child = nodes[child_index]!;
      child.fail = fallback_index;
      child.outputs.push(...nodes[fallback_index]!.outputs);
    }
  }
  return { nodes, pattern_lengths: patterns.map((pattern) => pattern.length) };
}

/** 将规范化坐标回写到原文 UTF-16 范围；同一 grapheme 展开产生的相同范围只保留一次。 */
function collect_matches(
  matcher: AhoMatcher,
  input: NormalizedText,
  bucket_indexes: number[],
  include: (pattern_index: number) => boolean,
  visit: (pattern_index: number, range: TextRange) => void,
): void {
  const previous_range_by_pattern = new Map<number, TextRange>();
  scan_aho_text(matcher, input.text, (bucket_index, text_index) => {
    const pattern_index = bucket_indexes[bucket_index]!;
    if (!include(pattern_index)) return false;
    const pattern_length = matcher.pattern_lengths[bucket_index]!;
    const folded_start = text_index - pattern_length + 1;
    const start = input.starts[folded_start]!;
    const end = input.ends[text_index]!;
    const previous_range = previous_range_by_pattern.get(pattern_index);
    if (previous_range?.start === start && previous_range.end === end) return false;
    const range = { start, end };
    previous_range_by_pattern.set(pattern_index, range);
    visit(pattern_index, range);
    return false;
  });
}

/** 合并规范化后会跨字素组合的片段，再建立到原文 UTF-16 范围的映射。 */
function normalize_text_with_source_ranges(
  text: string,
  case_modes: boolean[],
): Map<boolean, NormalizedText> {
  const segments: Array<TextRange & { text: string }> = [];
  for (const segment of GRAPHEME_SEGMENTER.segment(text)) {
    const value = normalize_literal_text(segment.segment, true);
    const end = segment.index + segment.segment.length;
    const previous = segments.at(-1);
    // 兼容 Jamo 等字符可在 NFKC 后跨原始字素组合，坐标需覆盖参与组合的双方。
    const joined = previous === undefined ? value : previous.text + value;
    const composed = joined.normalize("NFC");
    if (previous !== undefined && composed !== joined) {
      previous.text = composed;
      previous.end = end;
    } else {
      segments.push({ text: value, start: segment.index, end });
    }
  }
  const inputs = new Map<boolean, NormalizedText>(
    case_modes.map((mode) => [mode, { text: "", starts: [], ends: [] }]),
  );
  for (const { text: normalized, start, end } of segments) {
    for (const [case_sensitive, input] of inputs) {
      const value = case_sensitive ? normalized : fold_literal_text(normalized);
      input.text += value;
      for (let index = 0; index < value.length; index += 1) {
        input.starts.push(start);
        input.ends.push(end);
      }
    }
  }
  return inputs;
}
