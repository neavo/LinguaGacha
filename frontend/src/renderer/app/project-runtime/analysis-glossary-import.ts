import type {
  ProjectStoreQualityState,
  ProjectStoreState,
} from "@/app/project-runtime/project-store";
import {
  collect_project_item_texts,
  run_quality_statistics_task,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
} from "@/app/project-runtime/quality-statistics";
import {
  getQualityRuleSlice,
  replaceQualityRuleSlice,
} from "@/app/project-runtime/quality-runtime";

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
  case_sensitive: boolean;
};

type MergePreviewEntry = {
  entry: GlossaryEntry;
  is_new: boolean;
  incoming_indexes: number[];
};

type MergePreview = {
  merged_entries: GlossaryEntry[];
  entries: MergePreviewEntry[];
  report: {
    added: number;
    filled: number;
  };
};

type AnalysisGlossaryImportPlan = {
  imported_count: number;
  next_quality_state: ProjectStoreQualityState;
  next_analysis_state: Record<string, unknown>;
  next_task_snapshot: Record<string, unknown>;
  request_body: {
    entries: GlossaryEntry[];
    analysis_candidate_count: number;
    expected_section_revisions: Record<string, number>;
  };
};

const CONTROL_CODE_PATTERN = /\\(?:n|N){1,2}\[\d+\]/u;

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
      case_sensitive: entry.case_sensitive,
    });
  }
  return glossary_entries;
}

function fold_src(src: string): string {
  return src.normalize("NFKC").replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLocaleLowerCase();
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
    case_sensitive: Boolean(entry.case_sensitive),
  };
}

function merge_fill_empty(
  existing_entries: GlossaryEntry[],
  incoming_entries: GlossaryEntry[],
): MergePreview {
  const groups = new Map<
    string,
    Array<{
      entry: GlossaryEntry;
      order: number;
      is_existing: boolean;
      incoming_index: number | null;
    }>
  >();
  const existing_keys = new Set<string>();

  function ingest(
    entries: GlossaryEntry[],
    options: { is_existing: boolean; order_offset: number },
  ): void {
    entries.forEach((entry, index) => {
      const src_fold = fold_src(entry.src);
      const group = groups.get(src_fold);
      const item = {
        entry,
        order: options.order_offset + index,
        is_existing: options.is_existing,
        incoming_index: options.is_existing ? null : index,
      };
      if (group === undefined) {
        groups.set(src_fold, [item]);
      } else {
        group.push(item);
      }
    });
  }

  ingest(existing_entries, {
    is_existing: true,
    order_offset: 0,
  });
  ingest(incoming_entries, {
    is_existing: false,
    order_offset: existing_entries.length,
  });

  for (const [src_fold, items] of groups) {
    const fold_only = items.some((item) => !item.entry.case_sensitive);
    if (fold_only) {
      if (items.some((item) => item.is_existing)) {
        existing_keys.add(src_fold);
      }
      continue;
    }

    for (const item of items) {
      if (!item.is_existing) {
        continue;
      }
      existing_keys.add(`${src_fold}::${item.entry.src}`);
    }
  }

  const kept_entries: Array<{
    key: string;
    order: number;
    entry: GlossaryEntry;
    incoming_indexes: number[];
  }> = [];
  let added = 0;
  let filled = 0;

  for (const [src_fold, raw_items] of groups) {
    const items = [...raw_items].sort(
      (left_item, right_item) => left_item.order - right_item.order,
    );
    const fold_only = items.some((item) => !item.entry.case_sensitive);
    const grouped_items = fold_only
      ? new Map<string, typeof items>([[src_fold, items]])
      : items.reduce((map, item) => {
          const key = `${src_fold}::${item.entry.src}`;
          const group = map.get(key);
          if (group === undefined) {
            map.set(key, [item]);
          } else {
            group.push(item);
          }
          return map;
        }, new Map<string, typeof items>());

    for (const [key, grouped] of grouped_items) {
      const base = { ...grouped[0].entry };
      const incoming_indexes = grouped
        .flatMap((item) => (item.incoming_index === null ? [] : [item.incoming_index]))
        .sort((left_index, right_index) => left_index - right_index);

      for (const item of grouped.slice(1)) {
        if (base.dst === "" && item.entry.dst !== "") {
          base.dst = item.entry.dst;
          filled += 1;
        }
        if (base.info === "" && item.entry.info !== "") {
          base.info = item.entry.info;
          filled += 1;
        }
      }

      if (!existing_keys.has(key)) {
        added += 1;
      }

      kept_entries.push({
        key,
        order: grouped[0].order,
        entry: base,
        incoming_indexes,
      });
    }
  }

  kept_entries.sort((left_entry, right_entry) => left_entry.order - right_entry.order);
  return {
    merged_entries: kept_entries.map((entry) => entry.entry),
    entries: kept_entries.map((entry) => {
      return {
        entry: entry.entry,
        is_new: !existing_keys.has(entry.key),
        incoming_indexes: entry.incoming_indexes,
      };
    }),
    report: {
      added,
      filled,
    },
  };
}

function build_glossary_stat_key(entry: GlossaryEntry): string {
  return `${entry.src}|${entry.case_sensitive ? 1 : 0}`;
}

async function filter_import_candidates(args: {
  existing_entries: GlossaryEntry[];
  incoming_entries: GlossaryEntry[];
  state: ProjectStoreState;
}): Promise<{
  filtered_entries: GlossaryEntry[];
  imported_count: number;
}> {
  const preview = merge_fill_empty(args.existing_entries, args.incoming_entries);
  if (preview.entries.length === 0) {
    return {
      filtered_entries: [],
      imported_count: 0,
    };
  }

  const merged_entries = preview.merged_entries;
  const preview_entries = preview.entries.filter((entry) => entry.is_new);
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
        key: build_glossary_stat_key(entry.entry),
        src: entry.entry.src,
      };
    },
  );
  const statistics_result = await run_quality_statistics_task({
    rules,
    srcTexts,
    dstTexts,
    relationCandidates: relation_candidates,
    relationTargetCandidates: relation_target_candidates,
  });
  const key_by_src = new Map<string, string>();
  preview.entries.forEach((entry) => {
    key_by_src.set(entry.entry.src, build_glossary_stat_key(entry.entry));
  });

  const filtered_indexes = new Set<number>();
  for (const preview_entry of preview_entries) {
    const entry_key = build_glossary_stat_key(preview_entry.entry);
    const matched_item_count = statistics_result.results[entry_key]?.matched_item_count ?? 0;
    if (
      !is_control_code_self_mapping(preview_entry.entry.src, preview_entry.entry.dst) &&
      matched_item_count <= 1
    ) {
      preview_entry.incoming_indexes.forEach((index) => filtered_indexes.add(index));
      continue;
    }

    for (const parent_src of statistics_result.results[entry_key]?.subset_parents ?? []) {
      const parent_key = key_by_src.get(parent_src);
      if (parent_key === undefined) {
        continue;
      }
      const parent_count = statistics_result.results[parent_key]?.matched_item_count ?? 0;
      if (
        parent_count !== matched_item_count ||
        parent_src.length < preview_entry.entry.src.length
      ) {
        continue;
      }
      preview_entry.incoming_indexes.forEach((index) => filtered_indexes.add(index));
      break;
    }
  }

  const filtered_entries = args.incoming_entries.filter(
    (_entry, index) => !filtered_indexes.has(index),
  );
  if (filtered_entries.length === 0) {
    return {
      filtered_entries: [],
      imported_count: 0,
    };
  }

  const filtered_preview = merge_fill_empty(args.existing_entries, filtered_entries);
  return {
    filtered_entries,
    imported_count: filtered_preview.report.added + filtered_preview.report.filled,
  };
}

export async function create_analysis_glossary_import_plan(
  state: ProjectStoreState,
): Promise<AnalysisGlossaryImportPlan | null> {
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

  const filter_result = await filter_import_candidates({
    existing_entries: existing_glossary_entries,
    incoming_entries,
    state,
  });
  if (filter_result.filtered_entries.length === 0 || filter_result.imported_count <= 0) {
    return null;
  }

  const merged_preview = merge_fill_empty(
    existing_glossary_entries,
    filter_result.filtered_entries,
  );
  const next_quality_state = replaceQualityRuleSlice(state.quality, "glossary", {
    ...getQualityRuleSlice(state.quality, "glossary"),
    entries: merged_preview.merged_entries,
    revision: Number(state.quality.glossary.revision ?? 0) + 1,
  });
  const next_candidate_count = Math.max(
    0,
    Number(state.analysis.candidate_count ?? 0) - filter_result.imported_count,
  );

  return {
    imported_count: filter_result.imported_count,
    next_quality_state,
    next_analysis_state: {
      ...state.analysis,
      candidate_count: next_candidate_count,
    },
    next_task_snapshot: {
      ...state.task,
      analysis_candidate_count: next_candidate_count,
    },
    request_body: {
      entries: merged_preview.merged_entries,
      analysis_candidate_count: next_candidate_count,
      expected_section_revisions: {
        quality: state.revisions.sections.quality ?? 0,
        analysis: state.revisions.sections.analysis ?? 0,
      },
    },
  };
}
