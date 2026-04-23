import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
  QualityStatisticsTaskResult,
} from "@/app/project-runtime/quality-statistics";
import { casefold_text } from "@/app/project-runtime/quality-statistics";
import {
  isQualityStatisticsStaleError,
  type QualityStatisticsClient,
} from "@/app/project-runtime/quality-statistics-client";

export type QualityStatisticsAutoTextSource = "src" | "dst";

export type QualityStatisticsAutoRuleDescriptor = {
  key: string;
  dependency_parts: unknown[];
  relation_label: string;
  rule: QualityStatisticsRuleInput;
};

export type QualityStatisticsDependencyRuleSnapshot = {
  key: string;
  dependency_signature: string;
  relation_label: string;
  token: string;
};

export type QualityStatisticsDependencySnapshot = {
  text_source: QualityStatisticsAutoTextSource;
  text_signature: string;
  dependency_signature: string;
  snapshot_signature: string;
  rules: QualityStatisticsDependencyRuleSnapshot[];
};

export type QualityStatisticsAutoContext = {
  snapshot: QualityStatisticsDependencySnapshot;
  rules: QualityStatisticsRuleInput[];
  relation_candidates: QualityStatisticsRelationCandidate[];
};

export type QualityStatisticsAutoPlanReason =
  | "current"
  | "initial"
  | "rule_changed"
  | "text_changed"
  | "force_full";

export type QualityStatisticsAutoPlan =
  | {
      kind: "noop";
      reason: "current";
      text_source: QualityStatisticsAutoTextSource;
      target_rule_keys: string[];
      relation_target_keys: string[];
    }
  | {
      kind: "partial" | "full";
      reason: Exclude<QualityStatisticsAutoPlanReason, "current">;
      text_source: QualityStatisticsAutoTextSource;
      target_rule_keys: string[];
      relation_target_keys: string[];
    };

type QualityStatisticsResultMap = QualityStatisticsTaskResult["results"];

const MAX_PARTIAL_RULE_CHANGES = 6;

function build_rule_dependency_signature(dependency_parts: unknown[]): string {
  return JSON.stringify(dependency_parts);
}

function compare_snapshot_rules(
  left_rule: QualityStatisticsDependencyRuleSnapshot,
  right_rule: QualityStatisticsDependencyRuleSnapshot,
): number {
  if (left_rule.dependency_signature !== right_rule.dependency_signature) {
    return left_rule.dependency_signature.localeCompare(right_rule.dependency_signature);
  }

  if (left_rule.key !== right_rule.key) {
    return left_rule.key.localeCompare(right_rule.key);
  }

  return left_rule.relation_label.localeCompare(right_rule.relation_label);
}

function build_snapshot_rules(
  descriptors: QualityStatisticsAutoRuleDescriptor[],
): QualityStatisticsDependencyRuleSnapshot[] {
  const rules = descriptors.map((descriptor) => {
    return {
      key: descriptor.key,
      dependency_signature: build_rule_dependency_signature(descriptor.dependency_parts),
      relation_label: String(descriptor.relation_label ?? ""),
      token: "",
    };
  });

  rules.sort(compare_snapshot_rules);

  let group_start_index = 0;
  while (group_start_index < rules.length) {
    const group_dependency_signature = rules[group_start_index]?.dependency_signature ?? "";
    let group_end_index = group_start_index + 1;

    while (
      group_end_index < rules.length &&
      rules[group_end_index]?.dependency_signature === group_dependency_signature
    ) {
      group_end_index += 1;
    }

    const group_size = group_end_index - group_start_index;
    for (let index = group_start_index; index < group_end_index; index += 1) {
      const current_rule = rules[index];
      if (current_rule === undefined) {
        continue;
      }

      current_rule.token =
        group_size === 1
          ? current_rule.dependency_signature
          : `${current_rule.dependency_signature}#${(index - group_start_index).toString()}`;
    }

    group_start_index = group_end_index;
  }

  return rules;
}

function build_text_signature(texts: string[]): string {
  return JSON.stringify(texts);
}

function build_dependency_signature(
  text_source: QualityStatisticsAutoTextSource,
  text_signature: string,
  rules: QualityStatisticsDependencyRuleSnapshot[],
): string {
  return JSON.stringify({
    text_source,
    text_signature,
    tokens: rules.map((rule) => {
      return rule.token;
    }),
  });
}

function build_snapshot_signature(
  text_source: QualityStatisticsAutoTextSource,
  text_signature: string,
  rules: QualityStatisticsDependencyRuleSnapshot[],
): string {
  return JSON.stringify({
    text_source,
    text_signature,
    rules: rules.map((rule) => {
      return [rule.token, rule.key];
    }),
  });
}

function create_empty_result_entry(): { matched_item_count: number; subset_parents: string[] } {
  return {
    matched_item_count: 0,
    subset_parents: [],
  };
}

function clone_result_entry(
  result_entry: { matched_item_count?: number; subset_parents?: string[] } | undefined,
): { matched_item_count: number; subset_parents: string[] } {
  return {
    matched_item_count: result_entry?.matched_item_count ?? 0,
    subset_parents: [...(result_entry?.subset_parents ?? [])],
  };
}

function build_rule_count_map(
  rules: QualityStatisticsDependencyRuleSnapshot[],
  field: "token" | "relation_label",
): Map<string, number> {
  const count_map = new Map<string, number>();

  for (const rule of rules) {
    const field_value = String(rule[field] ?? "");
    count_map.set(field_value, (count_map.get(field_value) ?? 0) + 1);
  }

  return count_map;
}

function collect_rule_multiset_difference(
  source_rules: QualityStatisticsDependencyRuleSnapshot[],
  target_rules: QualityStatisticsDependencyRuleSnapshot[],
): QualityStatisticsDependencyRuleSnapshot[] {
  const remaining_count_map = build_rule_count_map(target_rules, "token");
  const diff_rules: QualityStatisticsDependencyRuleSnapshot[] = [];

  for (const rule of source_rules) {
    const remaining_count = remaining_count_map.get(rule.token) ?? 0;
    if (remaining_count > 0) {
      remaining_count_map.set(rule.token, remaining_count - 1);
      continue;
    }

    diff_rules.push(rule);
  }

  return diff_rules;
}

function collect_relation_label_difference(
  source_rules: QualityStatisticsDependencyRuleSnapshot[],
  target_rules: QualityStatisticsDependencyRuleSnapshot[],
): string[] {
  const remaining_count_map = build_rule_count_map(target_rules, "relation_label");
  const diff_labels: string[] = [];

  for (const rule of source_rules) {
    const relation_label = String(rule.relation_label ?? "");
    const remaining_count = remaining_count_map.get(relation_label) ?? 0;
    if (remaining_count > 0) {
      remaining_count_map.set(relation_label, remaining_count - 1);
      continue;
    }

    diff_labels.push(relation_label);
  }

  return diff_labels;
}

function are_relation_labels_linked(left_label: string, right_label: string): boolean {
  const normalized_left_label = String(left_label ?? "").trim();
  const normalized_right_label = String(right_label ?? "").trim();
  if (normalized_left_label === "" || normalized_right_label === "") {
    return false;
  }

  const left_fold = casefold_text(normalized_left_label);
  const right_fold = casefold_text(normalized_right_label);
  return left_fold.includes(right_fold) || right_fold.includes(left_fold);
}

function build_result_map_by_token(args: {
  snapshot: QualityStatisticsDependencySnapshot;
  results: QualityStatisticsResultMap;
}): Map<string, { matched_item_count: number; subset_parents: string[] }> {
  const result_map = new Map<string, { matched_item_count: number; subset_parents: string[] }>();

  for (const rule of args.snapshot.rules) {
    result_map.set(rule.token, clone_result_entry(args.results[rule.key]));
  }

  return result_map;
}

function build_empty_results(
  snapshot: QualityStatisticsDependencySnapshot,
): QualityStatisticsResultMap {
  return Object.fromEntries(
    snapshot.rules.map((rule) => {
      return [rule.key, create_empty_result_entry()];
    }),
  );
}

export function createQualityStatisticsAutoContext(args: {
  text_source: QualityStatisticsAutoTextSource;
  texts: string[];
  descriptors: QualityStatisticsAutoRuleDescriptor[];
}): QualityStatisticsAutoContext {
  const snapshot_rules = build_snapshot_rules(args.descriptors);
  const text_signature = build_text_signature(args.texts);

  return {
    snapshot: {
      text_source: args.text_source,
      text_signature,
      dependency_signature: build_dependency_signature(
        args.text_source,
        text_signature,
        snapshot_rules,
      ),
      snapshot_signature: build_snapshot_signature(
        args.text_source,
        text_signature,
        snapshot_rules,
      ),
      rules: snapshot_rules,
    },
    rules: args.descriptors.map((descriptor) => {
      return descriptor.rule;
    }),
    relation_candidates: args.descriptors.map((descriptor) => {
      return {
        key: descriptor.key,
        src: descriptor.relation_label,
      };
    }),
  };
}

export function areQualityStatisticsSnapshotsEqual(
  left_snapshot: QualityStatisticsDependencySnapshot | null,
  right_snapshot: QualityStatisticsDependencySnapshot,
): boolean {
  return left_snapshot?.snapshot_signature === right_snapshot.snapshot_signature;
}

export function remapQualityStatisticsResults(args: {
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  current_snapshot: QualityStatisticsDependencySnapshot;
  previous_results: QualityStatisticsResultMap;
}): QualityStatisticsResultMap {
  if (args.completed_snapshot === null) {
    return build_empty_results(args.current_snapshot);
  }

  const previous_result_map = build_result_map_by_token({
    snapshot: args.completed_snapshot,
    results: args.previous_results,
  });

  return Object.fromEntries(
    args.current_snapshot.rules.map((rule) => {
      return [rule.key, clone_result_entry(previous_result_map.get(rule.token))];
    }),
  );
}

export function planQualityStatisticsAutoRun(args: {
  current_snapshot: QualityStatisticsDependencySnapshot;
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  force_full?: boolean;
}): QualityStatisticsAutoPlan {
  const { current_snapshot, completed_snapshot } = args;

  if (completed_snapshot === null) {
    return {
      kind: "full",
      reason: "initial",
      text_source: current_snapshot.text_source,
      target_rule_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
      relation_target_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
    };
  }

  if (current_snapshot.dependency_signature === completed_snapshot.dependency_signature) {
    return {
      kind: "noop",
      reason: "current",
      text_source: current_snapshot.text_source,
      target_rule_keys: [],
      relation_target_keys: [],
    };
  }

  if (args.force_full) {
    return {
      kind: "full",
      reason: "force_full",
      text_source: current_snapshot.text_source,
      target_rule_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
      relation_target_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
    };
  }

  if (
    current_snapshot.text_source !== completed_snapshot.text_source ||
    current_snapshot.text_signature !== completed_snapshot.text_signature
  ) {
    return {
      kind: "full",
      reason: "text_changed",
      text_source: current_snapshot.text_source,
      target_rule_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
      relation_target_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
    };
  }

  const added_rules = collect_rule_multiset_difference(
    current_snapshot.rules,
    completed_snapshot.rules,
  );
  const removed_rules = collect_rule_multiset_difference(
    completed_snapshot.rules,
    current_snapshot.rules,
  );
  const changed_rule_count = added_rules.length + removed_rules.length;

  if (changed_rule_count > MAX_PARTIAL_RULE_CHANGES || current_snapshot.rules.length === 0) {
    return {
      kind: "full",
      reason: "rule_changed",
      text_source: current_snapshot.text_source,
      target_rule_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
      relation_target_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
    };
  }

  const relation_changed_labels = new Set<string>([
    ...collect_relation_label_difference(current_snapshot.rules, completed_snapshot.rules),
    ...collect_relation_label_difference(completed_snapshot.rules, current_snapshot.rules),
  ]);
  const partial_target_key_set = new Set<string>(
    added_rules.map((rule) => {
      return rule.key;
    }),
  );

  if (relation_changed_labels.size > 0) {
    for (const rule of current_snapshot.rules) {
      if (partial_target_key_set.has(rule.key)) {
        continue;
      }

      for (const relation_label of relation_changed_labels) {
        if (!are_relation_labels_linked(relation_label, rule.relation_label)) {
          continue;
        }

        partial_target_key_set.add(rule.key);
        break;
      }
    }
  }

  if (partial_target_key_set.size === 0) {
    return {
      kind: "noop",
      reason: "current",
      text_source: current_snapshot.text_source,
      target_rule_keys: [],
      relation_target_keys: [],
    };
  }

  if (partial_target_key_set.size >= current_snapshot.rules.length) {
    return {
      kind: "full",
      reason: "rule_changed",
      text_source: current_snapshot.text_source,
      target_rule_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
      relation_target_keys: current_snapshot.rules.map((rule) => {
        return rule.key;
      }),
    };
  }

  const partial_target_keys = current_snapshot.rules
    .filter((rule) => {
      return partial_target_key_set.has(rule.key);
    })
    .map((rule) => {
      return rule.key;
    });

  return {
    kind: "partial",
    reason: "rule_changed",
    text_source: current_snapshot.text_source,
    target_rule_keys: partial_target_keys,
    relation_target_keys: partial_target_keys,
  };
}

export async function executeQualityStatisticsAutoPlan(args: {
  client: QualityStatisticsClient;
  current_snapshot: QualityStatisticsDependencySnapshot;
  completed_snapshot: QualityStatisticsDependencySnapshot | null;
  previous_results: QualityStatisticsResultMap;
  plan: QualityStatisticsAutoPlan;
  rules: QualityStatisticsRuleInput[];
  relation_candidates: QualityStatisticsRelationCandidate[];
  src_texts: string[];
  dst_texts: string[];
}): Promise<
  | {
      kind: "success";
      results: QualityStatisticsResultMap;
    }
  | {
      kind: "stale";
    }
> {
  const base_results = remapQualityStatisticsResults({
    completed_snapshot: args.completed_snapshot,
    current_snapshot: args.current_snapshot,
    previous_results: args.previous_results,
  });

  if (args.plan.kind === "noop") {
    return {
      kind: "success",
      results: base_results,
    };
  }

  const target_key_set = new Set(args.plan.target_rule_keys);
  const target_rules = args.rules.filter((rule) => {
    return target_key_set.has(rule.key);
  });

  if (target_rules.length === 0) {
    return {
      kind: "success",
      results: base_results,
    };
  }

  try {
    const worker_result = await args.client.compute({
      rules: target_rules,
      srcTexts: args.src_texts,
      dstTexts: args.dst_texts,
      relationCandidates: args.relation_candidates,
      relationTargetCandidates:
        args.plan.kind === "partial"
          ? args.relation_candidates.filter((candidate) => {
              return target_key_set.has(candidate.key);
            })
          : undefined,
    });

    return {
      kind: "success",
      results: {
        ...base_results,
        ...Object.fromEntries(
          Object.entries(worker_result.results).map(([key, result]) => {
            return [key, clone_result_entry(result)];
          }),
        ),
      },
    };
  } catch (error) {
    if (isQualityStatisticsStaleError(error)) {
      return {
        kind: "stale",
      };
    }

    throw error;
  }
}
