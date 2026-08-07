/**
 * 分析候选到质量术语规则的纯导入规划。
 */
import {
  build_analysis_glossary_entries_from_candidates,
  collect_analysis_candidate_srcs_from_aggregate,
  is_analysis_control_code_self_mapping,
  type AnalysisCandidateGlossaryEntry,
} from "../../shared/analysis-candidate";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsRuleInput,
} from "../../shared/quality/quality-statistics";
import type { QualityRuleRelationCandidate } from "../../shared/quality/quality-rule-relations";
import { read_item_source_text_parts } from "../../shared/item-text";
import {
  QualityRuleImportRuleTypeValue,
  preview_quality_rule_import,
  type QualityRuleImportAction,
  type QualityRuleImportPreview,
} from "../../shared/quality/quality-rule-import";
import { is_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { QualityRule } from "../../domain/quality";
import type { CacheItem } from "../cache/cache-types";
import type { ProjectDataSectionRevisions } from "../../shared/project-event";
import type { GlossaryEntry } from "../../shared/quality/glossary";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";

export type PreparedAnalysisGlossaryImport = {
  duplicate_count: number; // 用于确认弹窗提示重复候选数量
  duplicate_signature: string; // 稳定描述重复集合，供 UI 判断弹窗是否需要刷新
  imported_count: number; // 本次实际进入术语表的候选数量
  consumed_count: number; // 本次从分析候选池移除的 src 数量
  quality_changed: boolean; // 控制是否写入 quality section
  updated_sections: Array<"quality" | "analysis">; // 后端写入的最小范围
  request_body: {
    entries: GlossaryEntry[]; // 完整术语表快照，保持 quality section 单点写入
    consumed_candidate_srcs: string[]; // 显式消费候选池，避免徽标残留
    expected_section_revisions: Record<string, number>; // 保护 quality/analysis 并发写
  };
};

export type AnalysisGlossaryImportPrepareRequest = {
  quality_block: JsonRecord;
  items: CacheItem[];
  section_revisions: ProjectDataSectionRevisions;
  candidate_aggregate: Record<string, unknown>;
  action?: QualityRuleImportAction;
};

/**
 * 从 quality section 的公开形状读取现有术语；损坏行由共享规则边界整批拒绝。
 */
function read_existing_glossary_entries(quality_block: JsonRecord): GlossaryEntry[] {
  const glossary_slice = is_json_record(quality_block["glossary"]) ? quality_block["glossary"] : {};
  return normalize_quality_rule_entries(
    QualityRule.from_json("glossary"),
    glossary_slice["entries"] ?? [],
  ) as GlossaryEntry[];
}

/**
 * 复用质量规则导入器生成覆盖、保留或取消所需的重复预览。
 */
function create_glossary_import_preview(
  existing_entries: GlossaryEntry[],
  incoming_entries: GlossaryEntry[],
): QualityRuleImportPreview {
  return preview_quality_rule_import({
    rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
    existing: existing_entries,
    incoming: incoming_entries,
  });
}

/**
 * 按持久字段和原顺序比较完整术语表，避免无变化时推进 quality revision。
 */
function are_glossary_entries_equal(
  left_entries: GlossaryEntry[],
  right_entries: GlossaryEntry[],
): boolean {
  if (left_entries.length !== right_entries.length) {
    return false;
  }

  for (let index = 0; index < left_entries.length; index += 1) {
    const left_entry = left_entries[index];
    const right_entry = right_entries[index];
    if (left_entry === undefined || right_entry === undefined) {
      return false;
    }
    if (
      left_entry.entry_id !== right_entry.entry_id ||
      left_entry.src !== right_entry.src ||
      left_entry.dst !== right_entry.dst ||
      left_entry.info !== right_entry.info ||
      left_entry.case_sensitive !== right_entry.case_sensitive
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 把重复项的定位与处理类型压成稳定签名，供确认请求检测预览漂移。
 */
function build_duplicate_signature(preview: QualityRuleImportPreview): string {
  return preview.duplicates
    .map((duplicate) => {
      return [
        duplicate.incoming_index,
        duplicate.key,
        duplicate.kind,
        duplicate.existing_indexes.join(","),
      ].join(":");
    })
    .join("|");
}

/**
 * 统计键同时包含大小写策略，避免同源文的不同匹配规则互相覆盖。
 */
function build_glossary_stat_key(entry: GlossaryEntry): string {
  return JSON.stringify([entry.src, entry.case_sensitive]);
}

/**
 * 候选条目复制为质量规则输入，阻断分析聚合对象的可变引用。
 */
function to_glossary_entries(entries: AnalysisCandidateGlossaryEntry[]): GlossaryEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

/**
 * 即使没有候选可写入质量规则，也要消费已处理的候选池，避免分析徽标永久残留。
 */
function build_candidate_pool_consumption_import(args: {
  existing_glossary_entries: GlossaryEntry[];
  section_revisions: ProjectDataSectionRevisions;
  consumed_candidate_srcs: string[];
}): PreparedAnalysisGlossaryImport | null {
  if (args.consumed_candidate_srcs.length === 0) {
    return null;
  }

  return {
    duplicate_count: 0,
    duplicate_signature: "",
    imported_count: 0,
    consumed_count: args.consumed_candidate_srcs.length,
    quality_changed: false,
    updated_sections: ["analysis"],
    request_body: {
      entries: args.existing_glossary_entries,
      consumed_candidate_srcs: args.consumed_candidate_srcs,
      expected_section_revisions: {
        quality: args.section_revisions.quality ?? 0,
        analysis: args.section_revisions.analysis ?? 0,
      },
    },
  };
}

/**
 * 候选只保留项目正文中真实命中的项；与更长父术语命中集合完全相同时删除子集噪音。
 */
function filter_import_candidates(args: {
  existing_entries: GlossaryEntry[];
  incoming_entries: GlossaryEntry[];
  items: CacheItem[];
}): GlossaryEntry[] {
  if (args.incoming_entries.length === 0) {
    return [];
  }

  const import_preview = create_glossary_import_preview(
    args.existing_entries,
    args.incoming_entries,
  );
  const merged_entries = import_preview.overwrite_entries as GlossaryEntry[];
  const src_text_groups = args.items.map((item) => read_item_source_text_parts(item));
  const rules: QualityStatisticsRuleInput[] = merged_entries.map((entry) => {
    return {
      entry_id: build_glossary_stat_key(entry),
      pattern: entry.src,
      pattern_kind: "literal",
      case_sensitive: entry.case_sensitive,
    };
  });
  const relation_candidates: QualityRuleRelationCandidate[] = merged_entries.map((entry) => {
    return {
      entry_id: build_glossary_stat_key(entry),
      src: entry.src,
      case_sensitive: entry.case_sensitive,
    };
  });
  const statistics_result = run_quality_statistics_task_sync({
    rules,
    text_groups: src_text_groups,
    relation_candidates,
  });
  const key_by_src = new Map<string, string>();
  merged_entries.forEach((entry) => {
    key_by_src.set(entry.src, build_glossary_stat_key(entry));
  });

  const filtered_indexes = new Set<number>();
  for (let index = 0; index < args.incoming_entries.length; index += 1) {
    const preview_entry = args.incoming_entries[index];
    if (preview_entry === undefined) {
      continue;
    }
    const entry_key = build_glossary_stat_key(preview_entry);
    const matched_item_count = statistics_result.results[entry_key]?.matched_item_count ?? 0;
    if (
      !is_analysis_control_code_self_mapping(preview_entry.src, preview_entry.dst) &&
      matched_item_count < 1
    ) {
      filtered_indexes.add(index);
      continue;
    }

    for (const parent_src of statistics_result.results[entry_key]?.subset_parents ?? []) {
      const parent_key = key_by_src.get(parent_src);
      if (parent_key === undefined) {
        continue;
      }
      const parent_count = statistics_result.results[parent_key]?.matched_item_count ?? 0;
      if (parent_count !== matched_item_count || parent_src.length < preview_entry.src.length) {
        continue;
      }
      filtered_indexes.add(index);
      break;
    }
  }

  return args.incoming_entries.filter((_entry, index) => !filtered_indexes.has(index));
}

/**
 * 基于当前后端 cache 准备分析术语导入计划，过滤无命中和被父术语覆盖的候选。
 */
export function prepare_analysis_glossary_import_from_cache(
  request: AnalysisGlossaryImportPrepareRequest,
): PreparedAnalysisGlossaryImport | null {
  const existing_glossary_entries = read_existing_glossary_entries(request.quality_block);
  const consumed_candidate_srcs = collect_analysis_candidate_srcs_from_aggregate(
    request.candidate_aggregate,
  );
  const incoming_entries = to_glossary_entries(
    build_analysis_glossary_entries_from_candidates(request.candidate_aggregate),
  );
  if (incoming_entries.length === 0) {
    return build_candidate_pool_consumption_import({
      existing_glossary_entries,
      section_revisions: request.section_revisions,
      consumed_candidate_srcs,
    });
  }

  const filtered_entries = filter_import_candidates({
    existing_entries: existing_glossary_entries,
    incoming_entries,
    items: request.items,
  });
  if (filtered_entries.length === 0) {
    return build_candidate_pool_consumption_import({
      existing_glossary_entries,
      section_revisions: request.section_revisions,
      consumed_candidate_srcs,
    });
  }

  const import_preview = create_glossary_import_preview(
    existing_glossary_entries,
    filtered_entries,
  );
  const action = request.action ?? "overwrite";
  const next_entries =
    action === "skip" ? import_preview.skip_entries : import_preview.overwrite_entries;
  const next_glossary_entries = normalize_quality_rule_entries(
    QualityRule.from_json("glossary"),
    next_entries,
  ) as GlossaryEntry[];
  const quality_changed = !are_glossary_entries_equal(
    existing_glossary_entries,
    next_glossary_entries,
  );
  const consumed_count = consumed_candidate_srcs.length;
  const imported_count =
    action === "skip" ? import_preview.non_duplicate_count : filtered_entries.length;
  const updated_sections: Array<"quality" | "analysis"> = quality_changed
    ? ["quality", "analysis"]
    : ["analysis"];

  return {
    duplicate_count: import_preview.duplicate_count,
    duplicate_signature: build_duplicate_signature(import_preview),
    imported_count,
    consumed_count,
    quality_changed,
    updated_sections,
    request_body: {
      entries: next_glossary_entries,
      consumed_candidate_srcs,
      expected_section_revisions: {
        quality: request.section_revisions.quality ?? 0,
        analysis: request.section_revisions.analysis ?? 0,
      },
    },
  };
}

/**
 * 将准备结果收窄为 API 可返回 JSON，保持 null 表达无需导入。
 */
export function to_analysis_glossary_import_prepare_payload(
  prepared_import: PreparedAnalysisGlossaryImport | null,
): JsonValue {
  return prepared_import as unknown as JsonValue;
}
