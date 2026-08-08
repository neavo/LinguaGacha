import { analyze_quality_rule_relations } from "../../../shared/quality/quality-rule-relations";
import { run_quality_statistics_task_sync } from "../../../shared/quality/quality-statistics";
import type { QualityStatisticsPreparedTaskInput } from "../../../shared/quality/quality-statistics-input";
import type { QualityRuleRelations } from "../../../shared/quality/quality-rule-relations";
import type { ItemTextGroup } from "../../../shared/item-text";

export type QualityRuleAnalysisWorkerTaskInput = QualityStatisticsPreparedTaskInput & {
  include_relations: boolean; // 规则未变化时复用后端关系缓存，避免 item 变更重复聚类
};

export type QualityRuleAnalysisWorkerTaskResult = {
  entry_ids: string[]; // 与输入规则顺序一致的完整结果身份
  hits_by_entry_id: Record<string, number>; // 每条规则命中的不同 item 数
  examples_by_entry_id: Record<string, string[]>; // 每条规则最多两个稳定纯文本例句
  relations?: QualityRuleRelations; // 只有 include_relations 为 true 时返回
};

/** 执行一次质量规则分析；hits 与 examples 共用扫描，关系仅在缓存缺失时计算。 */
export function run_quality_rule_analysis_worker_task(
  input: QualityRuleAnalysisWorkerTaskInput,
): QualityRuleAnalysisWorkerTaskResult {
  const statistics = run_quality_statistics_task_sync({
    rules: input.rules,
    text_groups: input.text_groups,
  });
  return {
    entry_ids: input.entry_ids,
    hits_by_entry_id: statistics.hits_by_entry_id,
    examples_by_entry_id: Object.fromEntries(
      input.entry_ids.map((entry_id) => [
        entry_id,
        (statistics.example_item_indexes_by_entry_id[entry_id] ?? []).flatMap((item_index) => {
          const text_group = input.text_groups[item_index];
          return text_group === undefined ? [] : [format_example(text_group, input.text_source)];
        }),
      ]),
    ),
    ...(input.include_relations
      ? {
          relations: analyze_quality_rule_relations(
            input.rules.map((rule) => ({
              entry_id: rule.entry_id,
              src: rule.pattern,
              pattern_kind: rule.pattern_kind,
              case_sensitive: rule.case_sensitive,
            })),
          ),
        }
      : {}),
  };
}

/** 从 worker 已捕获的同一文本快照投影规则实际扫描的一侧。 */
function format_example(text_group: ItemTextGroup, text_source: "src" | "dst"): string {
  const name_field = text_source === "src" ? "name_src" : "name_dst";
  const body = text_group
    .filter((part) => part.field === text_source)
    .map((part) => part.text)
    .join("\n");
  const name = text_group
    .filter((part) => part.field === name_field)
    .map((part) => part.text)
    .join("\n");
  return name === "" ? body : `【${name}】${body}`;
}
