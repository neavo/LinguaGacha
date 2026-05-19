import type { ProjectStoreState } from "@/project/store/project-store";
import { collect_project_item_texts } from "@/project/store/project-item-texts";
import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
} from "@/project/quality/quality-statistics";
import { getSharedProjectUiWorkerClient } from "@/project/worker/project-ui-worker-client";
import { getQualityRuleSlice } from "@/project/quality/quality-runtime";
import {
  build_analysis_glossary_entries_from_candidates,
  collect_analysis_candidate_srcs_from_aggregate,
  is_analysis_control_code_self_mapping,
  type AnalysisCandidateGlossaryEntry,
} from "@shared/analysis-candidate";
import {
  QualityRuleImportRuleTypeValue,
  preview_quality_rule_import,
  type QualityRuleImportAction,
  type QualityRuleImportPreview,
} from "@shared/quality/importer";

type GlossaryEntry = {
  src: string; // src 是术语匹配和重复检测的主键文本
  dst: string; // dst 是导入后写回质量规则的目标译文
  info: string; // info 保留候选来源附加说明
  regex: boolean; // regex 标记沿用质量规则的匹配模式
  case_sensitive: boolean; // case_sensitive 参与统计 key，避免大小写口径混淆
};

type PreparedAnalysisGlossaryImport = {
  duplicate_count: number; // duplicate_count 用于确认弹窗提示重复候选数量
  duplicate_signature: string; // duplicate_signature 稳定描述重复集合，供 UI 判断弹窗是否需要刷新
  imported_count: number; // imported_count 是本次实际进入术语表的候选数量
  consumed_count: number; // consumed_count 是本次从分析候选池移除的 src 数量
  quality_changed: boolean; // quality_changed 控制是否写入 quality section
  updated_sections: Array<"quality" | "analysis">; // updated_sections 是后端 mutation 的最小写入范围
  request_body: {
    entries: GlossaryEntry[]; // entries 是完整术语表快照，保持 quality section 单点写入
    consumed_candidate_srcs: string[]; // consumed_candidate_srcs 显式消费候选池，避免徽标残留
    expected_section_revisions: Record<string, number>; // expected_section_revisions 保护 quality/analysis 并发写
  };
};

export type AnalysisGlossaryImportAction = QualityRuleImportAction;

/**
 * 只接受有 src 的术语条目；其它字段在导入边界统一归一化。
 */
function normalize_glossary_entry(entry: Record<string, unknown>): GlossaryEntry | null {
  const src = String(entry.src ?? "").trim();
  if (src === "") {
    return null;
  }
  return {
    src,
    dst: String(entry.dst ?? "").trim(),
    info: String(entry.info ?? "").trim(),
    regex: Boolean(entry.regex ?? false),
    case_sensitive: Boolean(entry.case_sensitive),
  };
}

/**
 * 复用质量规则导入预演，保证分析候选和手动导入的重复判断口径一致。
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
 * 比较完整术语快照，判断本次导入是否真的改变 quality section。
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
      left_entry.src !== right_entry.src ||
      left_entry.dst !== right_entry.dst ||
      left_entry.info !== right_entry.info ||
      left_entry.regex !== right_entry.regex ||
      left_entry.case_sensitive !== right_entry.case_sensitive
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 把重复预演结果压成稳定签名，供 UI 在候选变化时识别同一批重复项。
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
 * 统计 key 必须同时包含大小写敏感配置，避免同 src 不同规则互相覆盖。
 */
function build_glossary_stat_key(entry: GlossaryEntry): string {
  return `${entry.src}|${entry.case_sensitive ? 1 : 0}`;
}

/**
 * 用项目文本命中统计过滤低价值候选；无命中且不是控制码自映射的候选不会导入。
 */
async function filter_import_candidates(args: {
  existing_entries: GlossaryEntry[];
  incoming_entries: GlossaryEntry[];
  state: ProjectStoreState;
}): Promise<GlossaryEntry[]> {
  if (args.incoming_entries.length === 0) {
    return [];
  }

  const import_preview = create_glossary_import_preview(
    args.existing_entries,
    args.incoming_entries,
  );
  const merged_entries = import_preview.overwrite_entries as GlossaryEntry[];
  const preview_entries = args.incoming_entries;
  const { srcTexts, dstTexts } = collect_project_item_texts(args.state.items);
  const rules: QualityStatisticsRuleInput[] = merged_entries.map((entry) => {
    return {
      key: build_glossary_stat_key(entry),
      pattern: entry.src,
      mode: "glossary",
      case_sensitive: entry.case_sensitive,
    };
  });
  const relation_candidates: QualityStatisticsRelationCandidate[] = merged_entries.map((entry) => {
    return {
      key: build_glossary_stat_key(entry),
      src: entry.src,
    };
  });
  const relation_target_candidates: QualityStatisticsRelationCandidate[] = preview_entries.map(
    (entry) => {
      return {
        key: build_glossary_stat_key(entry),
        src: entry.src,
      };
    },
  );
  const statistics_result = await getSharedProjectUiWorkerClient().compute_quality_statistics(
    {
      rules,
      srcTexts,
      dstTexts,
      relationCandidates: relation_candidates,
      relationTargetCandidates: relation_target_candidates,
    },
    {
      staleKey: "quality-statistics:analysis-glossary-importer",
      priority: "foreground",
    },
  );
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
 * 分析候选条目和质量规则条目同形但来源不同，这里切断引用避免后续意外共享对象。
 */
function to_glossary_entries(entries: AnalysisCandidateGlossaryEntry[]): GlossaryEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

/**
 * 没有可导入术语时仍消费候选池，让分析徽标和后端候选状态保持同步。
 */
function build_candidate_pool_consumption_import(args: {
  existing_glossary_entries: GlossaryEntry[];
  state: ProjectStoreState;
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
        quality: args.state.revisions.sections.quality ?? 0,
        analysis: args.state.revisions.sections.analysis ?? 0,
      },
    },
  };
}

/**
 * 从按需读取的分析候选池预演术语导入；导入会消费本轮候选池，避免统计过滤后的候选继续滞留徽标。
 */
export async function prepare_analysis_glossary_import(
  state: ProjectStoreState,
  options: {
    candidate_aggregate: Record<string, unknown>;
    action?: AnalysisGlossaryImportAction;
    task_snapshot?: Record<string, unknown>;
  },
): Promise<PreparedAnalysisGlossaryImport | null> {
  const existing_glossary_entries = getQualityRuleSlice(state.quality, "glossary").entries.flatMap(
    (entry) => {
      const normalized_entry = normalize_glossary_entry(entry);
      return normalized_entry === null ? [] : [normalized_entry];
    },
  );
  const consumed_candidate_srcs = collect_analysis_candidate_srcs_from_aggregate(
    options.candidate_aggregate,
  );
  const incoming_entries = to_glossary_entries(
    build_analysis_glossary_entries_from_candidates(options.candidate_aggregate),
  );
  if (incoming_entries.length === 0) {
    return build_candidate_pool_consumption_import({
      existing_glossary_entries,
      state,
      consumed_candidate_srcs,
    });
  }

  const filtered_entries = await filter_import_candidates({
    existing_entries: existing_glossary_entries,
    incoming_entries,
    state,
  });
  if (filtered_entries.length === 0) {
    return build_candidate_pool_consumption_import({
      existing_glossary_entries,
      state,
      consumed_candidate_srcs,
    });
  }

  const import_preview = create_glossary_import_preview(
    existing_glossary_entries,
    filtered_entries,
  );
  const action = options.action ?? "overwrite";
  const next_entries =
    action === "skip" ? import_preview.skip_entries : import_preview.overwrite_entries;
  const next_glossary_entries = next_entries as GlossaryEntry[];
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
        quality: state.revisions.sections.quality ?? 0,
        analysis: state.revisions.sections.analysis ?? 0,
      },
    },
  };
}
