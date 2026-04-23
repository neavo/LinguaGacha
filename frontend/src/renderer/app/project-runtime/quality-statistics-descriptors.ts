import { collect_project_item_texts } from "@/app/project-runtime/project-item-texts";
import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  createQualityStatisticsAutoContext,
  type QualityStatisticsAutoContext,
  type QualityStatisticsAutoRuleDescriptor,
} from "@/app/project-runtime/quality-statistics-auto";
import type { QualityStatisticsRuleType } from "@/app/project-runtime/quality-statistics-store";

type QualityStatisticsPreparedRuleContext = {
  project_item_texts: {
    srcTexts: string[];
    dstTexts: string[];
  };
  current_statistics_context: QualityStatisticsAutoContext;
};

function build_quality_entry_id(
  entry: { entry_id?: unknown; src?: unknown },
  index: number,
): string {
  if (typeof entry.entry_id === "string" && entry.entry_id !== "") {
    return entry.entry_id;
  }

  return `${String(entry.src ?? "").trim()}::${index.toString()}`;
}

function build_glossary_rule_descriptors(
  entries: Array<Record<string, unknown>>,
): QualityStatisticsAutoRuleDescriptor[] {
  return entries.map((entry, index) => {
    const entry_id = build_quality_entry_id(entry, index);
    const src = String(entry.src ?? "");
    const case_sensitive = Boolean(entry.case_sensitive);

    return {
      key: entry_id,
      dependency_parts: [src, case_sensitive],
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
      dependency_parts: [src, regex, case_sensitive],
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
        dependency_parts: [src],
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

export function buildQualityStatisticsRuleDescriptors(
  state: ProjectStoreState,
  rule_type: QualityStatisticsRuleType,
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

function resolve_text_source(rule_type: QualityStatisticsRuleType): "src" | "dst" {
  return rule_type === "post_replacement" ? "dst" : "src";
}

export function prepareQualityStatisticsRuleContext(
  state: ProjectStoreState,
  rule_type: QualityStatisticsRuleType,
): QualityStatisticsPreparedRuleContext {
  const project_item_texts = collect_project_item_texts(state.items);
  const text_source = resolve_text_source(rule_type);

  return {
    project_item_texts,
    current_statistics_context: createQualityStatisticsAutoContext({
      text_source,
      texts: text_source === "dst" ? project_item_texts.dstTexts : project_item_texts.srcTexts,
      descriptors: buildQualityStatisticsRuleDescriptors(state, rule_type),
    }),
  };
}

export type { QualityStatisticsPreparedRuleContext };
