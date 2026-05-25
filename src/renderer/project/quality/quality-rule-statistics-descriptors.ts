import { collect_project_item_texts } from "@/project/store/project-item-texts";
import type { ProjectStoreState } from "@/project/store/project-store";
import {
  createQualityStatisticsAutoContext,
  type QualityStatisticsAutoContext,
  type QualityStatisticsAutoRuleDescriptor,
} from "@/project/quality/quality-statistics-auto";
import { buildQualityRuleDependencyParts } from "@/project/quality/quality-runtime-context";
import type { QualityRuleStatisticsRuleType } from "@/project/quality/quality-rule-statistics-store";

type QualityRuleStatisticsPreparedRuleContext = {
  project_item_texts: {
    srcTexts: string[]; // srcTexts 是源文统计输入，供术语和前置替换规则消费
    dstTexts: string[]; // dstTexts 是译文统计输入，仅后置替换规则消费
  };
  current_statistics_context: QualityStatisticsAutoContext; // current_statistics_context 包含本规则当前依赖签名和候选关系
};

// build_quality_entry_id 为没有持久 id 的旧规则生成稳定局部 key。
function build_quality_entry_id(
  entry: { entry_id?: unknown; src?: unknown },
  index: number,
): string {
  if (typeof entry.entry_id === "string" && entry.entry_id !== "") {
    return entry.entry_id;
  }

  return `${String(entry.src ?? "").trim()}::${index.toString()}`;
}

// build_glossary_rule_descriptors 将术语表规则转为统计 worker 可消费的描述符。
function build_glossary_rule_descriptors(
  entries: Array<Record<string, unknown>>,
): QualityStatisticsAutoRuleDescriptor[] {
  return entries.map((entry, index) => {
    const entry_id = build_quality_entry_id(entry, index);
    const src = String(entry.src ?? "");
    const case_sensitive = Boolean(entry.case_sensitive);

    return {
      key: entry_id,
      dependency_parts: buildQualityRuleDependencyParts({ ruleType: "glossary", entry }),
      relation_label: src,
      rule: {
        key: entry_id,
        pattern: src,
        mode: "glossary",
        case_sensitive,
      },
    };
  });
}

// build_text_replacement_rule_descriptors 复用前置和后置替换规则的描述符构造口径。
function build_text_replacement_rule_descriptors(args: {
  entries: Array<Record<string, unknown>>;
  rule_type: "pre_replacement" | "post_replacement";
}): QualityStatisticsAutoRuleDescriptor[] {
  return args.entries.map((entry, index) => {
    const entry_id = build_quality_entry_id(entry, index);
    const src = String(entry.src ?? "");
    const regex = Boolean(entry.regex);
    const case_sensitive = Boolean(entry.case_sensitive);

    return {
      key: entry_id,
      dependency_parts: buildQualityRuleDependencyParts({ ruleType: args.rule_type, entry }),
      relation_label: src,
      rule: {
        key: entry_id,
        pattern: src,
        mode: args.rule_type,
        regex,
        case_sensitive,
      },
    };
  });
}

// build_text_preserve_rule_descriptors 只为非空保留文本创建正则统计规则。
function build_text_preserve_rule_descriptors(
  entries: Array<Record<string, unknown>>,
): QualityStatisticsAutoRuleDescriptor[] {
  return entries.flatMap((entry, index) => {
    const src = String(entry.src ?? "");
    if (src.trim() === "") {
      return [];
    }

    const entry_id = build_quality_entry_id(entry, index);
    return [
      {
        key: entry_id,
        dependency_parts: buildQualityRuleDependencyParts({ ruleType: "text_preserve", entry }),
        relation_label: src,
        rule: {
          key: entry_id,
          pattern: src,
          mode: "text_preserve",
          regex: true,
          case_sensitive: false,
        },
      },
    ];
  });
}

/**
 * 按质量规则类型读取 ProjectStore 中的公开规则，并生成统计任务描述符。
 */
export function buildQualityRuleStatisticsRuleDescriptors(
  state: ProjectStoreState,
  rule_type: QualityRuleStatisticsRuleType,
): QualityStatisticsAutoRuleDescriptor[] {
  if (rule_type === "glossary") {
    return build_glossary_rule_descriptors(state.quality.glossary.entries);
  }

  if (rule_type === "pre_replacement") {
    return build_text_replacement_rule_descriptors({
      entries: state.quality.pre_replacement.entries,
      rule_type: "pre_replacement",
    });
  }

  if (rule_type === "post_replacement") {
    return build_text_replacement_rule_descriptors({
      entries: state.quality.post_replacement.entries,
      rule_type: "post_replacement",
    });
  }

  return build_text_preserve_rule_descriptors(state.quality.text_preserve.entries);
}

// resolve_text_source 保证后置替换只检查译文，其它规则检查源文。
function resolve_text_source(rule_type: QualityRuleStatisticsRuleType): "src" | "dst" {
  return rule_type === "post_replacement" ? "dst" : "src";
}

/**
 * 准备单个规则统计上下文；调度器据此决定 noop、增量 remap 或 worker 计算。
 */
export function prepareQualityRuleStatisticsRuleContext(
  state: ProjectStoreState,
  rule_type: QualityRuleStatisticsRuleType,
): QualityRuleStatisticsPreparedRuleContext {
  const project_item_texts = collect_project_item_texts(state.items);
  const text_source = resolve_text_source(rule_type);

  return {
    project_item_texts,
    current_statistics_context: createQualityStatisticsAutoContext({
      text_source,
      texts: text_source === "dst" ? project_item_texts.dstTexts : project_item_texts.srcTexts,
      descriptors: buildQualityRuleStatisticsRuleDescriptors(state, rule_type),
    }),
  };
}

export type { QualityRuleStatisticsPreparedRuleContext };
