import type { ProjectStoreState } from "./project-store";

type QualityStatisticsRuleMode =
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

type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[];
  srcTexts: string[];
  dstTexts: string[];
  relationCandidates: QualityStatisticsRelationCandidate[];
  relationTargetCandidates?: QualityStatisticsRelationCandidate[];
};

type QualityStatisticsTaskResult = {
  results: Record<string, { matched_item_count: number; subset_parents: string[] }>;
};

type RelationSnapshot = {
  key: string;
  src: string;
  srcFold: string;
  length: number;
};

function casefold_text(text: string): string {
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

function count_matched_items(texts: string[], predicate: (text: string) => boolean): number {
  let matched_count = 0;
  for (const text of texts) {
    if (predicate(text)) {
      matched_count += 1;
    }
  }
  return matched_count;
}

function count_rule_occurrences(
  rule: QualityStatisticsRuleInput,
  src_texts: string[],
  dst_texts: string[],
): number {
  const pattern = String(rule.pattern ?? "");
  if (pattern === "") {
    return 0;
  }

  const texts = rule.mode === "post_replacement" ? dst_texts : src_texts;
  if (texts.length === 0) {
    return 0;
  }

  if (rule.mode === "glossary") {
    if (rule.case_sensitive) {
      return count_matched_items(texts, (text) => text.includes(pattern));
    }

    const folded_pattern = casefold_text(pattern);
    return count_matched_items(texts, (text) => {
      return casefold_text(text).includes(folded_pattern);
    });
  }

  const is_regex_mode = rule.mode === "text_preserve" || rule.regex;
  const flags = rule.mode === "text_preserve" ? "iu" : rule.case_sensitive ? "u" : "iu";
  const compiled_pattern = compile_pattern(is_regex_mode ? pattern : escape_regexp(pattern), flags);
  if (compiled_pattern === null) {
    return 0;
  }

  return count_matched_items(texts, (text) => {
    return compiled_pattern.test(text);
  });
}

function build_relation_snapshots(
  candidates: QualityStatisticsRelationCandidate[],
): RelationSnapshot[] {
  return candidates.flatMap((candidate) => {
    const key = String(candidate.key ?? "").trim();
    const src = String(candidate.src ?? "").trim();
    if (key === "" || src === "") {
      return [];
    }

    const src_fold = casefold_text(src);
    return [
      {
        key,
        src,
        srcFold: src_fold,
        length: src_fold.length,
      },
    ];
  });
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

function build_subset_relation_map(args: {
  relationCandidates: QualityStatisticsRelationCandidate[];
  relationTargetCandidates?: QualityStatisticsRelationCandidate[];
}): Record<string, string[]> {
  const target_snapshots = build_relation_snapshots(
    args.relationTargetCandidates ?? args.relationCandidates,
  );
  const scope_snapshots = dedupe_relation_scope(build_relation_snapshots(args.relationCandidates));
  const subset_parent_map: Record<string, string[]> = {};

  for (const target_snapshot of target_snapshots) {
    const parents: string[] = [];

    for (const scope_snapshot of scope_snapshots) {
      if (scope_snapshot.length <= target_snapshot.length) {
        continue;
      }
      if (scope_snapshot.key === target_snapshot.key) {
        continue;
      }
      if (scope_snapshot.srcFold === target_snapshot.srcFold) {
        continue;
      }
      if (!scope_snapshot.srcFold.includes(target_snapshot.srcFold)) {
        continue;
      }

      parents.push(scope_snapshot.src);
    }

    if (parents.length > 0) {
      subset_parent_map[target_snapshot.key] = parents;
    }
  }

  return subset_parent_map;
}

export function collect_project_item_texts(items: ProjectStoreState["items"]): {
  srcTexts: string[];
  dstTexts: string[];
} {
  const src_texts: string[] = [];
  const dst_texts: string[] = [];

  for (const item of Object.values(items)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    src_texts.push(String((item as { src?: string }).src ?? ""));
    dst_texts.push(String((item as { dst?: string }).dst ?? ""));
  }

  return {
    srcTexts: src_texts,
    dstTexts: dst_texts,
  };
}

export async function run_quality_statistics_task(
  input: QualityStatisticsTaskInput,
): Promise<QualityStatisticsTaskResult> {
  const subset_parent_map = build_subset_relation_map({
    relationCandidates: input.relationCandidates,
    relationTargetCandidates: input.relationTargetCandidates,
  });
  const results: QualityStatisticsTaskResult["results"] = {};

  for (const rule of input.rules) {
    results[rule.key] = {
      matched_item_count: count_rule_occurrences(rule, input.srcTexts, input.dstTexts),
      subset_parents: subset_parent_map[rule.key] ?? [],
    };
  }

  return {
    results,
  };
}
