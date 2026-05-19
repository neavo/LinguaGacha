import type { ProjectStoreState } from "@/project/store/project-store";
import { collect_project_item_texts } from "@/project/store/project-item-texts";
import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
} from "@/project/quality/quality-statistics";
import { getSharedQualityStatisticsWorkerPool } from "@/project/quality/quality-statistics-worker-pool";
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
  src: string;
  dst: string;
  info: string;
  regex: boolean;
  case_sensitive: boolean;
};

type PreparedAnalysisGlossaryImport = {
  duplicate_count: number;
  duplicate_signature: string;
  imported_count: number;
  consumed_count: number;
  quality_changed: boolean;
  updated_sections: Array<"quality" | "analysis">;
  request_body: {
    entries: GlossaryEntry[];
    consumed_candidate_srcs: string[];
    expected_section_revisions: Record<string, number>;
  };
};

export type AnalysisGlossaryImportAction = QualityRuleImportAction;

const quality_statistics_worker_pool = getSharedQualityStatisticsWorkerPool();

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

function build_glossary_stat_key(entry: GlossaryEntry): string {
  return `${entry.src}|${entry.case_sensitive ? 1 : 0}`;
}

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
  const statistics_result = await quality_statistics_worker_pool.submit(
    {
      rules,
      srcTexts,
      dstTexts,
      relationCandidates: relation_candidates,
      relationTargetCandidates: relation_target_candidates,
    },
    {
      stale_key: "quality-statistics:analysis-glossary-importer",
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

function to_glossary_entries(entries: AnalysisCandidateGlossaryEntry[]): GlossaryEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

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
