import type { ProjectStoreQualityState, ProjectStoreState } from "@/project/store/project-store";
import { collect_project_item_texts } from "@/project/store/project-item-texts";
import type {
  QualityStatisticsRelationCandidate,
  QualityStatisticsRuleInput,
} from "@/project/quality/quality-statistics";
import { getSharedQualityStatisticsWorkerPool } from "@/project/quality/quality-statistics-worker-pool";
import { getQualityRuleSlice, replaceQualityRuleSlice } from "@/project/quality/quality-runtime";
import {
  QualityRuleImportRuleTypeValue,
  preview_quality_rule_import,
  type QualityRuleImportAction,
  type QualityRuleImportPreview,
} from "@shared/quality/importer";

type CandidateAggregateEntry = {
  src: string;
  dst_votes: Record<string, number>;
  info_votes: Record<string, number>;
  case_sensitive: boolean;
};

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
  next_quality_state: ProjectStoreQualityState;
  next_analysis_state: Record<string, unknown>;
  next_task_snapshot: Record<string, unknown>;
  updated_sections: Array<"quality" | "analysis">;
  request_body: {
    entries: GlossaryEntry[];
    analysis_candidate_count: number;
    consumed_candidate_srcs: string[];
    expected_glossary_revision: number;
    expected_section_revisions: Record<string, number>;
  };
};

export type AnalysisGlossaryImportAction = QualityRuleImportAction;

const CONTROL_CODE_PATTERN = /\\(?:n|N){1,2}\[\d+\]/u;
const quality_statistics_worker_pool = getSharedQualityStatisticsWorkerPool();

function normalize_vote_map(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [raw_text, raw_votes] of Object.entries(value as Record<string, unknown>)) {
    const text = String(raw_text).trim();
    const votes = Number(raw_votes);
    if (text === "" || !Number.isFinite(votes) || votes <= 0) {
      continue;
    }
    normalized[text] = (normalized[text] ?? 0) + votes;
  }
  return normalized;
}

function normalize_candidate_aggregate_entry(
  src: string,
  value: unknown,
): CandidateAggregateEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const normalized_src = String(candidate.src ?? src).trim();
  const dst_votes = normalize_vote_map(candidate.dst_votes);
  const info_votes = normalize_vote_map(candidate.info_votes);
  if (normalized_src === "" || Object.keys(dst_votes).length === 0) {
    return null;
  }

  return {
    src: normalized_src,
    dst_votes,
    info_votes,
    case_sensitive: Boolean(candidate.case_sensitive),
  };
}

function pick_candidate_winner(votes: Record<string, number>): string {
  let winner = "";
  let winner_votes = -1;
  for (const [text, count] of Object.entries(votes)) {
    if (count > winner_votes) {
      winner = text;
      winner_votes = count;
    }
  }
  return winner;
}

function is_control_code_self_mapping(src: string, dst: string): boolean {
  const normalized_src = src.trim();
  const normalized_dst = dst.trim();
  return (
    normalized_src !== "" &&
    normalized_src === normalized_dst &&
    CONTROL_CODE_PATTERN.test(normalized_src)
  );
}

function build_glossary_from_candidates(
  candidate_aggregate: Record<string, unknown>,
): GlossaryEntry[] {
  const glossary_entries: GlossaryEntry[] = [];
  for (const [raw_src, raw_entry] of Object.entries(candidate_aggregate).sort(
    (left_entry, right_entry) => {
      return left_entry[0].localeCompare(right_entry[0], "zh-Hans-CN");
    },
  )) {
    const entry = normalize_candidate_aggregate_entry(raw_src, raw_entry);
    if (entry === null) {
      continue;
    }

    const dst = pick_candidate_winner(entry.dst_votes).trim();
    const info = pick_candidate_winner(entry.info_votes).trim();
    if (entry.src === "" || dst === "" || info === "") {
      continue;
    }
    if (dst === entry.src && !is_control_code_self_mapping(entry.src, dst)) {
      continue;
    }
    if (["其它", "其他", "other", "others"].includes(info.toLowerCase())) {
      continue;
    }

    glossary_entries.push({
      src: entry.src,
      dst,
      info,
      regex: false,
      case_sensitive: entry.case_sensitive,
    });
  }
  return glossary_entries;
}

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

function normalize_record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function remove_consumed_candidate_aggregate(
  value: unknown,
  consumed_srcs: string[],
): Record<string, unknown> {
  const consumed_src_set = new Set(
    consumed_srcs.map((src) => src.trim()).filter((src) => src !== ""),
  );
  if (consumed_src_set.size === 0) {
    return normalize_record(value);
  }

  const next_candidate_aggregate: Record<string, unknown> = {};
  for (const [raw_src, raw_entry] of Object.entries(normalize_record(value))) {
    const normalized_entry = normalize_candidate_aggregate_entry(raw_src, raw_entry);
    const raw_src_norm = raw_src.trim();
    if (
      (normalized_entry !== null && consumed_src_set.has(normalized_entry.src)) ||
      consumed_src_set.has(raw_src_norm)
    ) {
      continue;
    }
    next_candidate_aggregate[raw_src] = raw_entry;
  }
  return next_candidate_aggregate;
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
      !is_control_code_self_mapping(preview_entry.src, preview_entry.dst) &&
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

export async function prepare_analysis_glossary_import(
  state: ProjectStoreState,
  options: {
    action?: AnalysisGlossaryImportAction;
    task_snapshot?: Record<string, unknown>;
  } = {},
): Promise<PreparedAnalysisGlossaryImport | null> {
  const existing_glossary_entries = getQualityRuleSlice(state.quality, "glossary").entries.flatMap(
    (entry) => {
      const normalized_entry = normalize_glossary_entry(entry);
      return normalized_entry === null ? [] : [normalized_entry];
    },
  );
  const incoming_entries = build_glossary_from_candidates(
    (state.analysis.candidate_aggregate ?? {}) as Record<string, unknown>,
  );
  if (incoming_entries.length === 0) {
    return null;
  }

  const filtered_entries = await filter_import_candidates({
    existing_entries: existing_glossary_entries,
    incoming_entries,
    state,
  });
  if (filtered_entries.length === 0) {
    return null;
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
  const next_quality_state = replaceQualityRuleSlice(state.quality, "glossary", {
    ...getQualityRuleSlice(state.quality, "glossary"),
    entries: next_glossary_entries,
    revision: Number(state.quality.glossary.revision ?? 0) + (quality_changed ? 1 : 0),
  });
  const consumed_count = filtered_entries.length;
  const consumed_candidate_srcs = filtered_entries.map((entry) => entry.src);
  const next_candidate_count = Math.max(
    0,
    Number(state.analysis.candidate_count ?? 0) - consumed_count,
  );
  const task_snapshot = options.task_snapshot ?? {};
  const task_extras = normalize_record(task_snapshot["extras"]);
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
    next_quality_state,
    next_analysis_state: {
      ...state.analysis,
      candidate_count: next_candidate_count,
      candidate_aggregate: remove_consumed_candidate_aggregate(
        state.analysis.candidate_aggregate,
        consumed_candidate_srcs,
      ),
    },
    next_task_snapshot: {
      ...task_snapshot,
      extras: {
        ...task_extras,
        kind: "analysis",
        candidate_count: next_candidate_count,
      },
    },
    updated_sections,
    request_body: {
      entries: next_glossary_entries,
      analysis_candidate_count: next_candidate_count,
      consumed_candidate_srcs,
      expected_glossary_revision: Number(state.quality.glossary.revision ?? 0),
      expected_section_revisions: {
        quality: state.revisions.sections.quality ?? 0,
        analysis: state.revisions.sections.analysis ?? 0,
      },
    },
  };
}
