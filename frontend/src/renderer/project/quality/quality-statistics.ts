export type QualityStatisticsRuleMode =
  | "glossary"
  | "pre_replacement"
  | "post_replacement"
  | "text_preserve";

export type QualityStatisticsRuleInput = {
  key: string;
  pattern: string;
  mode: QualityStatisticsRuleMode;
  regex?: boolean;
  case_sensitive?: boolean;
};

export type QualityStatisticsRelationCandidate = {
  key: string;
  src: string;
};

export type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[];
  srcTexts: string[];
  dstTexts: string[];
  relationCandidates: QualityStatisticsRelationCandidate[];
  relationTargetCandidates?: QualityStatisticsRelationCandidate[];
};

type QualityStatisticsTaskResultEntry = {
  matched_item_count: number;
  subset_parents: string[];
};

export type QualityStatisticsTaskResult = {
  results: Record<string, QualityStatisticsTaskResultEntry>;
};

type TextSource = "src" | "dst";

type LiteralRuleBucket = {
  source: TextSource;
  caseSensitive: boolean;
  patternKeys: string[][];
  patterns: string[];
};

type CompiledRegexRuleBucket = {
  keys: string[];
  regexp: RegExp;
  source: TextSource;
};

type AhoNode = {
  next: Map<string, number>;
  fail: number;
  outputs: number[];
};

type AhoMatcher = {
  nodes: AhoNode[];
  patternCount: number;
};

type QualityStatisticsTextViews = {
  getTexts: (source: TextSource, caseSensitive: boolean) => string[];
};

type RelationSnapshot = {
  key: string;
  src: string;
  srcFold: string;
  length: number;
  order: number;
};

type RelationTargetGroup = {
  pattern: string;
  length: number;
  targets: RelationSnapshot[];
};

export function casefold_text(text: string): string {
  return text.normalize("NFKC").replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLocaleLowerCase();
}

function escape_regexp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile_pattern(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

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

function resolve_rule_source(mode: QualityStatisticsRuleMode): TextSource {
  return mode === "post_replacement" ? "dst" : "src";
}

function is_literal_rule(rule: QualityStatisticsRuleInput): boolean {
  if (rule.mode === "glossary") {
    return true;
  }

  return rule.mode !== "text_preserve" && !rule.regex;
}

function is_case_sensitive_rule(rule: QualityStatisticsRuleInput): boolean {
  return rule.case_sensitive === true;
}

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
      rule.mode === "text_preserve" || rule.regex ? raw_pattern : escape_regexp(raw_pattern);
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
