import { escape_text_pattern } from "@shared/text/text-pattern";

export type QualityStatisticsRuleMode =
  | "glossary"
  | "pre_replacement"
  | "post_replacement"
  | "text_preserve";

export type QualityStatisticsRuleInput = {
  key: string; // key 是统计结果返回给调用方的稳定索引
  pattern: string; // pattern 是术语、替换规则或文本保护规则的匹配表达式
  mode: QualityStatisticsRuleMode; // mode 决定匹配原文/译文以及字面量/正则口径
  regex?: boolean; // regex 仅替换类规则使用，true 时按原始正则编译
  case_sensitive?: boolean; // case_sensitive 决定是否使用大小写折叠文本视图
};

export type QualityStatisticsRelationCandidate = {
  key: string; // key 对应规则结果，用于写回 subset_parents
  src: string; // src 是参与包含关系判断的源文本
};

export type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[]; // rules 是本次需要计算命中数的规则集合
  srcTexts: string[]; // srcTexts 是按项目条目顺序排列的原文集合
  dstTexts: string[]; // dstTexts 是按项目条目顺序排列的译文集合
  relationCandidates: QualityStatisticsRelationCandidate[]; // relationCandidates 是父子关系判断的完整范围
  relationTargetCandidates?: QualityStatisticsRelationCandidate[]; // relationTargetCandidates 限定局部计划只计算目标关系
};

type QualityStatisticsTaskResultEntry = {
  matched_item_count: number; // matched_item_count 统计有至少一次命中的项目条目数量
  subset_parents: string[]; // subset_parents 记录包含当前术语的更长父级术语
};

export type QualityStatisticsTaskResult = {
  results: Record<string, QualityStatisticsTaskResultEntry>; // results 按规则 key 返回统计项
};

// 统计执行器只暴露计算能力，让调度器和测试不用知道 worker 通道细节。
export type QualityStatisticsTaskExecutor = {
  compute: (input: QualityStatisticsTaskInput) => Promise<QualityStatisticsTaskResult>;
};

type TextSource = "src" | "dst"; // TextSource 是 worker 内部文本视图选择，不暴露到缓存层

type LiteralRuleBucket = {
  source: TextSource; // source 决定读取原文还是译文文本数组
  caseSensitive: boolean; // caseSensitive 决定 pattern 和文本是否走 casefold
  patternKeys: string[][]; // patternKeys 保存同一 pattern 对应的全部规则 key
  patterns: string[]; // patterns 是 Aho-Corasick matcher 的去重字面量集合
};

type CompiledRegexRuleBucket = {
  keys: string[]; // keys 共享同一个已编译正则的规则列表
  regexp: RegExp; // regexp 是已带 flags 的可执行正则
  source: TextSource; // source 决定正则作用于原文还是译文
};

type AhoNode = {
  next: Map<string, number>; // next 是字符到子节点索引的转移表
  fail: number; // fail 是失配时回退的节点索引
  outputs: number[]; // outputs 保存当前节点命中的 pattern 索引
};

type AhoMatcher = {
  nodes: AhoNode[]; // nodes 是紧凑 trie/自动机节点数组
  patternCount: number; // patternCount 用于分配 per-text 去重数组
};

type QualityStatisticsTextViews = {
  getTexts: (source: TextSource, caseSensitive: boolean) => string[]; // getTexts 懒构建大小写折叠文本视图
};

type RelationSnapshot = {
  key: string; // key 是 subset_parents 回写目标
  src: string; // src 保留原始父级术语文本用于 UI 展示
  srcFold: string; // srcFold 用于大小写无关的包含关系匹配
  length: number; // length 用于排除自身和更短候选作为父级
  order: number; // order 保留原始候选顺序，便于未来稳定排序
};

type RelationTargetGroup = {
  pattern: string; // pattern 是按 srcFold 分组后的目标术语文本
  length: number; // length 是目标术语长度，用来判断父子方向
  targets: RelationSnapshot[]; // targets 保存同文本的多个规则 key
};

/**
 * 统一大小写折叠规则；质量统计和自动规划共享这个文本口径。
 */
export function casefold_text(text: string): string {
  return text.normalize("NFKC").replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLocaleLowerCase();
}

/**
 * 编译用户规则正则；非法正则在统计阶段跳过，不中断整个任务。
 */
function compile_pattern(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * 将关系候选归一化为可匹配快照，空 key 或空 src 不参与父子关系。
 */
function build_relation_snapshots(
  candidates: QualityStatisticsRelationCandidate[],
): RelationSnapshot[] {
  const snapshots: RelationSnapshot[] = [];

  candidates.forEach((candidate, index) => {
    const key = String(candidate.key ?? "").trim();
    const src = String(candidate.src ?? "").trim();
    if (key === "" || src === "") {
      return;
    }

    const src_fold = casefold_text(src);
    snapshots.push({
      key,
      src,
      srcFold: src_fold,
      length: src_fold.length,
      order: index,
    });
  });

  return snapshots;
}

/**
 * 在父级搜索范围内按折叠文本去重，避免同一父级文本重复写入 subset_parents。
 */
function dedupe_relation_scope(scope_snapshots: RelationSnapshot[]): RelationSnapshot[] {
  const seen_folds = new Set<string>();
  const deduped_snapshots: RelationSnapshot[] = [];

  for (const snapshot of scope_snapshots) {
    if (seen_folds.has(snapshot.srcFold)) {
      continue;
    }

    seen_folds.add(snapshot.srcFold);
    deduped_snapshots.push(snapshot);
  }

  return deduped_snapshots;
}

/**
 * 根据规则类型选择统计文本来源；后置替换检查译文，其它规则检查原文。
 */
function resolve_rule_source(mode: QualityStatisticsRuleMode): TextSource {
  return mode === "post_replacement" ? "dst" : "src";
}

/**
 * 判断规则是否可以走字面量批量匹配，术语固定按字面量处理。
 */
function is_literal_rule(rule: QualityStatisticsRuleInput): boolean {
  if (rule.mode === "glossary") {
    return true;
  }

  return rule.mode !== "text_preserve" && !rule.regex;
}

/**
 * 判断是否保留大小写；未显式声明时默认大小写不敏感。
 */
function is_case_sensitive_rule(rule: QualityStatisticsRuleInput): boolean {
  return rule.case_sensitive === true;
}

/**
 * 懒构建原文/译文的大小写折叠视图，避免每个 bucket 重复转换大数组。
 */
function build_text_views(src_texts: string[], dst_texts: string[]): QualityStatisticsTextViews {
  let folded_src_texts: string[] | null = null;
  let folded_dst_texts: string[] | null = null;

  return {
    getTexts(source, caseSensitive) {
      if (caseSensitive) {
        return source === "dst" ? dst_texts : src_texts;
      }

      if (source === "dst") {
        if (folded_dst_texts === null) {
          folded_dst_texts = dst_texts.map((text) => casefold_text(text));
        }
        return folded_dst_texts;
      }

      if (folded_src_texts === null) {
        folded_src_texts = src_texts.map((text) => casefold_text(text));
      }
      return folded_src_texts;
    },
  };
}

/**
 * 将字面量规则按文本来源和大小写口径分桶，便于一次自动机扫描统计多条规则。
 */
function build_literal_rule_buckets(rules: QualityStatisticsRuleInput[]): LiteralRuleBucket[] {
  const bucket_map = new Map<
    string,
    { source: TextSource; caseSensitive: boolean; pattern_map: Map<string, string[]> }
  >();

  for (const rule of rules) {
    if (!is_literal_rule(rule)) {
      continue;
    }

    const raw_pattern = String(rule.pattern ?? "");
    if (raw_pattern === "") {
      continue;
    }

    const source = resolve_rule_source(rule.mode);
    const case_sensitive = is_case_sensitive_rule(rule);
    const normalized_pattern = case_sensitive ? raw_pattern : casefold_text(raw_pattern);
    const bucket_key = `${source}|${case_sensitive ? "1" : "0"}`;
    const bucket = bucket_map.get(bucket_key) ?? {
      source,
      caseSensitive: case_sensitive,
      pattern_map: new Map<string, string[]>(),
    };
    const pattern_keys = bucket.pattern_map.get(normalized_pattern) ?? [];
    pattern_keys.push(rule.key);
    bucket.pattern_map.set(normalized_pattern, pattern_keys);
    bucket_map.set(bucket_key, bucket);
  }

  return [...bucket_map.values()].map((bucket) => {
    const patterns = [...bucket.pattern_map.keys()];
    return {
      source: bucket.source,
      caseSensitive: bucket.caseSensitive,
      patterns,
      patternKeys: patterns.map((pattern) => {
        return bucket.pattern_map.get(pattern) ?? [];
      }),
    };
  });
}

/**
 * 将正则规则按来源、flags 和 pattern 合并，避免重复编译相同正则。
 */
function build_regex_rule_buckets(rules: QualityStatisticsRuleInput[]): CompiledRegexRuleBucket[] {
  const bucket_map = new Map<string, CompiledRegexRuleBucket>();

  for (const rule of rules) {
    if (is_literal_rule(rule)) {
      continue;
    }

    const raw_pattern = String(rule.pattern ?? "");
    if (raw_pattern === "") {
      continue;
    }

    const source = resolve_rule_source(rule.mode);
    const flags = rule.mode === "text_preserve" ? "iu" : is_case_sensitive_rule(rule) ? "u" : "iu";
    const pattern =
      rule.mode === "text_preserve" || rule.regex ? raw_pattern : escape_text_pattern(raw_pattern);
    const bucket_key = `${source}|${flags}|${pattern}`;
    const existing_bucket = bucket_map.get(bucket_key);
    if (existing_bucket !== undefined) {
      existing_bucket.keys.push(rule.key);
      continue;
    }

    const compiled_pattern = compile_pattern(pattern, flags);
    if (compiled_pattern === null) {
      continue;
    }

    bucket_map.set(bucket_key, {
      keys: [rule.key],
      regexp: compiled_pattern,
      source,
    });
  }

  return [...bucket_map.values()];
}

/**
 * 为字面量集合构建 Aho-Corasick 自动机，实现单次扫描匹配多 pattern。
 */
function build_aho_matcher(patterns: string[]): AhoMatcher | null {
  if (patterns.length === 0) {
    return null;
  }

  const nodes: AhoNode[] = [
    {
      next: new Map<string, number>(),
      fail: 0,
      outputs: [],
    },
  ];

  patterns.forEach((pattern, pattern_index) => {
    let node_index = 0;

    for (const character of pattern) {
      const next_node_index = nodes[node_index].next.get(character);
      if (next_node_index !== undefined) {
        node_index = next_node_index;
        continue;
      }

      const created_node_index = nodes.length;
      nodes.push({
        next: new Map<string, number>(),
        fail: 0,
        outputs: [],
      });
      nodes[node_index].next.set(character, created_node_index);
      node_index = created_node_index;
    }

    nodes[node_index].outputs.push(pattern_index);
  });

  const queue: number[] = [];
  for (const next_node_index of nodes[0].next.values()) {
    queue.push(next_node_index);
  }

  for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
    const node_index = queue[queue_index];
    const node = nodes[node_index];

    for (const [character, child_index] of node.next.entries()) {
      queue.push(child_index);
      let fail_index = node.fail;

      while (fail_index !== 0 && !nodes[fail_index].next.has(character)) {
        fail_index = nodes[fail_index].fail;
      }

      const fallback_index = nodes[fail_index].next.get(character) ?? 0;
      nodes[child_index].fail = fallback_index;
      nodes[child_index].outputs.push(...nodes[fallback_index].outputs);
    }
  }

  return {
    nodes,
    patternCount: patterns.length,
  };
}

/**
 * 收集单条文本命中的 pattern 索引，同一 pattern 在同一文本中只计一次。
 */
function collect_literal_match_indexes(
  matcher: AhoMatcher,
  text: string,
  seen_generation_by_pattern: Uint32Array,
  generation: number,
): number[] {
  const matched_indexes: number[] = [];
  let node_index = 0;

  for (const character of text) {
    while (node_index !== 0 && !matcher.nodes[node_index].next.has(character)) {
      node_index = matcher.nodes[node_index].fail;
    }

    node_index = matcher.nodes[node_index].next.get(character) ?? 0;
    const outputs = matcher.nodes[node_index].outputs;
    if (outputs.length === 0) {
      continue;
    }

    for (const pattern_index of outputs) {
      if (seen_generation_by_pattern[pattern_index] === generation) {
        continue;
      }

      seen_generation_by_pattern[pattern_index] = generation;
      matched_indexes.push(pattern_index);
    }
  }

  return matched_indexes;
}

/**
 * 统计每个字面量 pattern 命中的项目条目数，而不是总出现次数。
 */
function count_literal_bucket_matches(texts: string[], patterns: string[]): Uint32Array {
  const matcher = build_aho_matcher(patterns);
  const matched_counts = new Uint32Array(patterns.length);
  if (matcher === null) {
    return matched_counts;
  }

  const seen_generation_by_pattern = new Uint32Array(matcher.patternCount);

  texts.forEach((text, index) => {
    const generation = index + 1;
    const matched_indexes = collect_literal_match_indexes(
      matcher,
      text,
      seen_generation_by_pattern,
      generation,
    );

    for (const pattern_index of matched_indexes) {
      matched_counts[pattern_index] += 1;
    }
  });

  return matched_counts;
}

/**
 * 把字面量 bucket 的命中数写回各规则结果，同 pattern 多 key 会共享计数。
 */
function assign_literal_rule_counts(args: {
  rules: QualityStatisticsRuleInput[];
  textViews: QualityStatisticsTextViews;
  results: QualityStatisticsTaskResult["results"];
}): void {
  const buckets = build_literal_rule_buckets(args.rules);

  for (const bucket of buckets) {
    const texts = args.textViews.getTexts(bucket.source, bucket.caseSensitive);
    const matched_counts = count_literal_bucket_matches(texts, bucket.patterns);

    bucket.patternKeys.forEach((pattern_keys, pattern_index) => {
      const matched_item_count = matched_counts[pattern_index] ?? 0;

      for (const key of pattern_keys) {
        args.results[key] = {
          ...args.results[key],
          matched_item_count,
        };
      }
    });
  }
}

/**
 * 逐条执行正则 bucket，并把“至少命中一次”的项目条目数写回结果。
 */
function assign_regex_rule_counts(args: {
  rules: QualityStatisticsRuleInput[];
  textViews: QualityStatisticsTextViews;
  results: QualityStatisticsTaskResult["results"];
}): void {
  const regex_buckets = build_regex_rule_buckets(args.rules);

  for (const bucket of regex_buckets) {
    const texts = args.textViews.getTexts(bucket.source, true);
    let matched_item_count = 0;

    for (const text of texts) {
      if (!bucket.regexp.test(text)) {
        continue;
      }

      matched_item_count += 1;
    }

    for (const key of bucket.keys) {
      args.results[key] = {
        ...args.results[key],
        matched_item_count,
      };
    }
  }
}

/**
 * 按折叠后的目标文本分组，避免父子关系匹配重复构建相同 pattern。
 */
function build_relation_target_groups(target_snapshots: RelationSnapshot[]): RelationTargetGroup[] {
  const group_map = new Map<string, RelationTargetGroup>();

  for (const target_snapshot of target_snapshots) {
    const existing_group = group_map.get(target_snapshot.srcFold);
    if (existing_group !== undefined) {
      existing_group.targets.push(target_snapshot);
      continue;
    }

    group_map.set(target_snapshot.srcFold, {
      pattern: target_snapshot.srcFold,
      length: target_snapshot.length,
      targets: [target_snapshot],
    });
  }

  return [...group_map.values()];
}

/**
 * 构建每个目标术语的父级术语列表；局部统计时只计算 targetCandidates 的关系。
 */
function build_subset_relation_map(args: {
  relationCandidates: QualityStatisticsRelationCandidate[];
  relationTargetCandidates?: QualityStatisticsRelationCandidate[];
}): Record<string, string[]> {
  const target_snapshots = build_relation_snapshots(
    args.relationTargetCandidates ?? args.relationCandidates,
  );
  const scope_snapshots = dedupe_relation_scope(build_relation_snapshots(args.relationCandidates));
  const target_groups = build_relation_target_groups(target_snapshots);
  const subset_parent_map: Record<string, string[]> = {};
  const matcher = build_aho_matcher(
    target_groups.map((target_group) => {
      return target_group.pattern;
    }),
  );

  if (matcher === null) {
    return subset_parent_map;
  }

  const seen_generation_by_pattern = new Uint32Array(matcher.patternCount);

  scope_snapshots.forEach((scope_snapshot, index) => {
    const matched_indexes = collect_literal_match_indexes(
      matcher,
      scope_snapshot.srcFold,
      seen_generation_by_pattern,
      index + 1,
    );

    for (const matched_index of matched_indexes) {
      const target_group = target_groups[matched_index];
      if (target_group === undefined || target_group.length >= scope_snapshot.length) {
        continue;
      }

      for (const target_snapshot of target_group.targets) {
        if (target_snapshot.key === scope_snapshot.key) {
          continue;
        }

        const parents = subset_parent_map[target_snapshot.key] ?? [];
        parents.push(scope_snapshot.src);
        subset_parent_map[target_snapshot.key] = parents;
      }
    }
  });

  return subset_parent_map;
}

/**
 * 执行质量统计任务；该函数运行在 Project UI Worker 内，不触碰 renderer 状态。
 */
export async function run_quality_statistics_task(
  input: QualityStatisticsTaskInput,
): Promise<QualityStatisticsTaskResult> {
  const subset_parent_map = build_subset_relation_map({
    relationCandidates: input.relationCandidates,
    relationTargetCandidates: input.relationTargetCandidates,
  });
  const results: QualityStatisticsTaskResult["results"] = {};
  const text_views = build_text_views(input.srcTexts, input.dstTexts);

  for (const rule of input.rules) {
    results[rule.key] = {
      matched_item_count: 0,
      subset_parents: subset_parent_map[rule.key] ?? [],
    };
  }

  assign_literal_rule_counts({
    rules: input.rules,
    textViews: text_views,
    results,
  });
  assign_regex_rule_counts({
    rules: input.rules,
    textViews: text_views,
    results,
  });

  return {
    results,
  };
}
