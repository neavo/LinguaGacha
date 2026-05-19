import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
  QualityStatisticsTaskExecutor,
  QualityStatisticsTaskResult,
} from "@/project/quality/quality-statistics";
import { casefold_text } from "@/project/quality/quality-statistics";
import { is_project_ui_worker_client_error } from "@/project/worker/project-ui-worker-errors";
import { JsonTool } from "../../../shared/utils/json-tool";

export type QualityStatisticsAutoTextSource = "src" | "dst"; // 统计文本来源，决定快照和 worker 输入使用原文还是译文

export type QualityStatisticsAutoRuleDescriptor = {
  key: string; // key 是统计结果回写缓存的稳定索引
  dependency_parts: unknown[]; // dependency_parts 描述影响该规则统计结果的全部配置
  relation_label: string; // relation_label 用于判断局部重算时的父子术语关联
  rule: QualityStatisticsRuleInput; // rule 是最终派发给 worker 的规则载荷
};

export type QualityStatisticsDependencyRuleSnapshot = {
  key: string; // key 保留规则自身身份，允许同依赖规则映射回原结果
  dependency_signature: string; // dependency_signature 只表达规则配置，不包含列表位置
  relation_label: string; // relation_label 是局部关系扩散的可读文本
  token: string; // token 是去重后的依赖身份，相同配置规则用序号拆分
};

export type QualityStatisticsDependencySnapshot = {
  text_source: QualityStatisticsAutoTextSource; // text_source 变化必须触发全量统计
  text_signature: string; // text_signature 表示当前项目文本集合
  dependency_signature: string; // dependency_signature 用于判断统计结果是否仍然可复用
  snapshot_signature: string; // snapshot_signature 同时包含 key，用于 UI 缓存身份判断
  rules: QualityStatisticsDependencyRuleSnapshot[]; // rules 是按依赖稳定排序后的规则快照
};

export type QualityStatisticsAutoContext = {
  snapshot: QualityStatisticsDependencySnapshot; // snapshot 是调度层做增量规划的只读事实
  rules: QualityStatisticsRuleInput[]; // rules 是 worker 实际计算的规则列表
  relation_candidates: QualityStatisticsRelationCandidate[]; // relation_candidates 用于计算术语包含关系
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

const MAX_PARTIAL_RULE_CHANGES = 6; // 超过该数量时全量计算通常比维护局部依赖更稳定

/**
 * 把规则依赖部件序列化成稳定签名，所有增量判断都依赖这个口径。
 */
function build_rule_dependency_signature(dependency_parts: unknown[]): string {
  return JsonTool.stringifyStrict(dependency_parts);
}

/**
 * 规则快照按依赖、key、关系标签排序，消除数组顺序对增量计划的影响。
 */
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

/**
 * 构建规则依赖快照，并为相同依赖签名的规则分配可复用 token。
 */
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

/**
 * 文本签名按顺序滚动哈希每条文本，避免规划阶段反复 stringify 全量文本数组
 */
function build_text_signature(texts: string[]): string {
  let hash = 2166136261;
  for (const [index, text] of texts.entries()) {
    const framed_text = `${index.toString()}:${text.length.toString()}:${text}`;
    for (let char_index = 0; char_index < framed_text.length; char_index += 1) {
      hash ^= framed_text.charCodeAt(char_index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${texts.length.toString()}:${hash.toString(36)}`;
}

/**
 * dependency_signature 不含 key，只回答“已有统计值是否还能复用”。
 */
function build_dependency_signature(
  text_source: QualityStatisticsAutoTextSource,
  text_signature: string,
  rules: QualityStatisticsDependencyRuleSnapshot[],
): string {
  return JsonTool.stringifyStrict({
    text_source,
    text_signature,
    tokens: rules.map((rule) => {
      return rule.token;
    }),
  });
}

/**
 * snapshot_signature 含 key，用于区分同依赖但不同规则身份的 UI 缓存快照。
 */
function build_snapshot_signature(
  text_source: QualityStatisticsAutoTextSource,
  text_signature: string,
  rules: QualityStatisticsDependencyRuleSnapshot[],
): string {
  return JsonTool.stringifyStrict({
    text_source,
    text_signature,
    rules: rules.map((rule) => {
      return [rule.token, rule.key];
    }),
  });
}

/**
 * 创建空结果项，供首次或无历史结果的规则占位。
 */
function create_empty_result_entry(): { matched_item_count: number; subset_parents: string[] } {
  return {
    matched_item_count: 0,
    subset_parents: [],
  };
}

/**
 * 克隆 worker 结果项，避免缓存复用时共享可变数组引用。
 */
function clone_result_entry(
  result_entry: { matched_item_count?: number; subset_parents?: string[] } | undefined,
): { matched_item_count: number; subset_parents: string[] } {
  return {
    matched_item_count: result_entry?.matched_item_count ?? 0,
    subset_parents: [...(result_entry?.subset_parents ?? [])],
  };
}

/**
 * 统计规则快照中指定字段的多重集合数量，用于处理重复规则。
 */
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

/**
 * 计算 source 相对 target 的多重集合差集，重复规则会按 token 数量逐个抵消。
 */
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

/**
 * 计算关系标签差集，局部重算会沿包含关系扩散到受影响的规则。
 */
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

/**
 * 判断两个关系标签是否可能互为父子术语；这里只做大小写折叠后的包含关系。
 */
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

/**
 * 把历史结果按 token 重映射，规则 key 改变但依赖未变时仍可复用统计值。
 */
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

/**
 * 为当前快照生成全空结果，保证 UI 不会读到缺失 key。
 */
function build_empty_results(
  snapshot: QualityStatisticsDependencySnapshot,
): QualityStatisticsResultMap {
  return Object.fromEntries(
    snapshot.rules.map((rule) => {
      return [rule.key, create_empty_result_entry()];
    }),
  );
}

/**
 * 从当前文本和规则描述符创建增量统计上下文。
 */
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

/**
 * 比较完整快照身份，供 store 判断缓存是否对应当前统计上下文。
 */
export function areQualityStatisticsSnapshotsEqual(
  left_snapshot: QualityStatisticsDependencySnapshot | null,
  right_snapshot: QualityStatisticsDependencySnapshot,
): boolean {
  return left_snapshot?.snapshot_signature === right_snapshot.snapshot_signature;
}

/**
 * 把历史统计结果映射到当前快照；无法复用的规则会回落为空结果。
 */
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

/**
 * 根据当前快照和已完成快照生成 noop、局部或全量统计计划。
 */
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

/**
 * 执行自动统计计划；局部计划只派发目标规则，再合并到重映射后的基础结果。
 */
export async function executeQualityStatisticsAutoPlan(args: {
  executor: QualityStatisticsTaskExecutor;
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
    const worker_result = await args.executor.compute({
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
    if (is_project_ui_worker_client_error(error, "stale")) {
      return {
        kind: "stale",
      };
    }

    throw error;
  }
}
