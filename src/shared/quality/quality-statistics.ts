import type { ItemTextGroup } from "../item-text";
import {
  compile_literal_patterns,
  fold_literal_text,
  type TextRange,
} from "../text/literal-matcher";
import { compile_text_pattern, matches_text_pattern } from "../text/text-pattern";

const LITERAL_CONTEXT_CHARACTER_PATTERN = /[\p{L}\p{N}]/u;

export type QualityStatisticsRuleInput = {
  entry_id: string; // worker 结果与页面条目的唯一关联键
  pattern: string; // 已通过真实编译校验的规则文本
  pattern_kind: "literal" | "regex"; // 决定共享 matcher 或独立正则路径
  case_sensitive: boolean; // 匹配大小写策略
};

export type QualityStatisticsRelationCandidate = {
  entry_id: string; // 与统计规则共享的结果键
  src: string; // 仅字面量规则参与父子包含关系
};

type QualityStatisticsDependencyRuleSnapshot = {
  key: string; // 当前 entry_id，变更时只影响结果身份
  dependency_signature: string; // 不含身份的规则执行配置
  token: string; // 同配置规则按出现顺序区分的依赖令牌
};

export type QualityStatisticsDependencySnapshot = {
  text_source: "src" | "dst"; // 当前规则实际扫描的 item 文本侧
  text_signature: string; // 进程内判断文本事实是否改变的签名
  dependency_signature: string; // 忽略 entry_id 的计算依赖签名
  snapshot_signature: string; // 包含 entry_id 的页面结果身份签名
  rules: QualityStatisticsDependencyRuleSnapshot[]; // 按输入顺序保存规则依赖
};

export type QualityStatisticsTaskInput = {
  rules: QualityStatisticsRuleInput[]; // 主线程完成归一后交给 worker 的规则
  text_groups: ItemTextGroup[]; // 每个 item 的 src/name_src 或 dst/name_dst 字段组
  relation_candidates: QualityStatisticsRelationCandidate[]; // 仅需计算包含关系的字面量规则
  collect_literal_evidence?: boolean; // Agent glossary 查询才收集次数与有限 sample
};

export type QualityStatisticsLiteralEvidence = {
  total_matches: number; // 全部字段中的真实匹配范围数
  context_sample: {
    item_index: number; // 与输入 text_groups 和 captured items 的稳定数组索引一致
    matched_fields: Array<"src" | "name_src">; // sample 中实际命中的原文字段
  } | null;
};

export type QualityStatisticsTaskResult = {
  results: Record<
    string,
    {
      matched_item_count: number; // 至少一个字段命中的 item 数，不累计同 item 次数
      subset_parents: string[]; // 包含当前 src 的更长字面量源文
    }
  >;
  literal_evidence_by_entry_id?: Record<string, QualityStatisticsLiteralEvidence>;
};

/** 对调用方准备好的单一文本源计算命中 item 数和字面量包含关系。 */
export function run_quality_statistics_task_sync(
  input: QualityStatisticsTaskInput,
): QualityStatisticsTaskResult {
  const results = Object.fromEntries(
    input.rules.map((rule) => [
      rule.entry_id,
      { matched_item_count: 0, subset_parents: [] as string[] },
    ]),
  );
  const literal_evidence_by_entry_id = input.collect_literal_evidence
    ? Object.fromEntries(
        input.rules
          .filter((rule) => rule.pattern_kind === "literal")
          .map((rule) => [rule.entry_id, { total_matches: 0, context_sample: null }]),
      )
    : undefined;
  assign_literal_counts(input.rules, input.text_groups, results, literal_evidence_by_entry_id);
  assign_regex_counts(input.rules, input.text_groups, results);

  const subset_parents = build_subset_relation_map(input.relation_candidates);
  for (const [entry_id, parents] of Object.entries(subset_parents)) {
    const result = results[entry_id];
    if (result !== undefined) result.subset_parents = parents;
  }
  return {
    results,
    ...(literal_evidence_by_entry_id === undefined ? {} : { literal_evidence_by_entry_id }),
  };
}

/** 字面量规则共用一次 matcher 扫描，并在每个 item 内累计覆盖数与有限证据。 */
function assign_literal_counts(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  results: QualityStatisticsTaskResult["results"],
  evidence_by_entry_id: Record<string, QualityStatisticsLiteralEvidence> | undefined,
): void {
  const literal_rules = rules.filter((rule) => rule.pattern_kind === "literal");
  const matcher = compile_literal_patterns(
    literal_rules.map((rule) => ({
      key: rule.entry_id,
      text: rule.pattern,
      case_sensitive: rule.case_sensitive,
    })),
  );
  for (const [item_index, text_group] of text_groups.entries()) {
    const matched_entry_ids = new Set<string>();
    const item_evidence =
      evidence_by_entry_id === undefined
        ? undefined
        : {
            by_entry_id: evidence_by_entry_id,
            ranges_by_entry_id: new Map<string, Map<number, TextRange[]>>(),
            fields_by_entry_id: new Map<string, Array<"src" | "name_src">>(),
          };
    for (const [part_index, part] of text_group.entries()) {
      for (const match of matcher.match(part.text)) {
        matched_entry_ids.add(match.key);
        if (item_evidence === undefined) continue;
        const part_ranges =
          item_evidence.ranges_by_entry_id.get(match.key) ?? new Map<number, TextRange[]>();
        part_ranges.set(part_index, match.ranges);
        item_evidence.ranges_by_entry_id.set(match.key, part_ranges);
        const evidence = item_evidence.by_entry_id[match.key];
        if (evidence !== undefined) evidence.total_matches += match.ranges.length;
        if (part.field === "src" || part.field === "name_src") {
          const fields = item_evidence.fields_by_entry_id.get(match.key) ?? [];
          if (!fields.includes(part.field)) fields.push(part.field);
          item_evidence.fields_by_entry_id.set(match.key, fields);
        }
      }
    }
    for (const entry_id of matched_entry_ids) {
      const result = results[entry_id];
      if (result !== undefined) result.matched_item_count += 1;
      const evidence = evidence_by_entry_id?.[entry_id];
      const ranges_by_part = item_evidence?.ranges_by_entry_id.get(entry_id);
      if (
        evidence !== undefined &&
        ranges_by_part !== undefined &&
        evidence.context_sample === null &&
        has_literal_context(text_group, ranges_by_part)
      ) {
        evidence.context_sample = {
          item_index,
          matched_fields: item_evidence?.fields_by_entry_id.get(entry_id) ?? [],
        };
      }
    }
  }
}

/** 命中区间之外仍有 Unicode 字母或数字时，该 item 才能作为有效语境。 */
function has_literal_context(
  text_group: ItemTextGroup,
  ranges_by_part: Map<number, TextRange[]>,
): boolean {
  return text_group.some((part, part_index) => {
    const ranges = ranges_by_part.get(part_index);
    if (ranges === undefined) return LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text);
    const merged: TextRange[] = [];
    for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
      const previous = merged.at(-1);
      if (previous === undefined || range.start > previous.end) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
    }
    let cursor = 0;
    for (const range of merged) {
      if (LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text.slice(cursor, range.start))) return true;
      cursor = range.end;
    }
    return LITERAL_CONTEXT_CHARACTER_PATTERN.test(part.text.slice(cursor));
  });
}

/** 正则规则独立统计至少命中一个字段的 item 数。 */
function assign_regex_counts(
  rules: QualityStatisticsRuleInput[],
  text_groups: ItemTextGroup[],
  results: QualityStatisticsTaskResult["results"],
): void {
  const compiled = rules
    .filter((rule) => rule.pattern_kind === "regex")
    .map((rule) => {
      const pattern = compile_text_pattern({
        source_text: rule.pattern,
        mode: "regex",
        case_sensitive: rule.case_sensitive,
        trim: false,
      });
      if (pattern === null) throw new TypeError("质量统计正则不能为空");
      return { rule, pattern };
    });
  for (const { rule, pattern } of compiled) {
    for (const text_group of text_groups) {
      if (text_group.some((part) => matches_text_pattern(part.text, pattern))) {
        const result = results[rule.entry_id];
        if (result !== undefined) result.matched_item_count += 1;
      }
    }
  }
}

/** 包含关系只比较显式字面量候选，并按父文本首次出现顺序输出。 */
function build_subset_relation_map(
  candidates: QualityStatisticsRelationCandidate[],
): Record<string, string[]> {
  const snapshots = candidates.map((candidate) => ({
    ...candidate,
    folded: fold_literal_text(candidate.src),
  }));
  const snapshot_by_entry_id = new Map(
    snapshots.map((snapshot) => [snapshot.entry_id, snapshot] as const),
  );
  const matcher = compile_literal_patterns(
    snapshots.map((snapshot) => ({
      key: snapshot.entry_id,
      text: snapshot.folded,
      case_sensitive: true,
    })),
  );
  const result: Record<string, string[]> = {};
  const seen_parent_text = new Set<string>();
  for (const parent of snapshots) {
    if (seen_parent_text.has(parent.folded)) continue;
    seen_parent_text.add(parent.folded);
    for (const match of matcher.match(parent.folded)) {
      const child = snapshot_by_entry_id.get(match.key);
      if (
        child === undefined ||
        child.entry_id === parent.entry_id ||
        child.folded.length >= parent.folded.length
      ) {
        continue;
      }
      const parents = result[child.entry_id] ?? [];
      parents.push(parent.src);
      result[child.entry_id] = parents;
    }
  }
  return result;
}
