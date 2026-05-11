import type { ProjectStoreState } from "@/project/store/project-store";
import {
  build_analysis_status_summary,
  build_translation_task_and_project_state,
  clone_runtime_project_item_record,
  normalize_runtime_project_item_record,
  type RuntimeProjectItemRecord,
} from "@/project/reset/reset-state-builders";
import { should_skip_by_language_filter } from "@shared/rules/language-filter";
import { should_skip_by_rule_filter } from "@shared/rules/rule-filter";

type ProjectPrefilterFileRecord = {
  rel_path: string;
  file_type: string;
};

type ProjectPrefilterStats = {
  rule_skipped: number;
  language_skipped: number;
  mtool_skipped: number;
  duplicated: number;
};

export type ProjectPrefilterMutationOutput = {
  items: Record<string, Record<string, unknown>>;
  analysis: Record<string, unknown>;
  translation_extras: Record<string, unknown>;
  task_snapshot: Record<string, unknown>;
  project_settings: {
    source_language: string;
    target_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  };
  prefilter_config: {
    source_language: string;
    mtool_optimizer_enable: boolean;
    skip_duplicate_source_text_enable: boolean;
  };
  stats: ProjectPrefilterStats;
};

export type ProjectPrefilterMutationInput = {
  state: ProjectStoreState;
  source_language: string;
  target_language?: string;
  mtool_optimizer_enable: boolean;
  skip_duplicate_source_text_enable: boolean;
};

function normalize_file_record(value: unknown): ProjectPrefilterFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as ProjectPrefilterFileRecord).rel_path ?? ""),
    file_type: String((value as ProjectPrefilterFileRecord).file_type ?? "NONE"),
  };
}

export function compute_project_prefilter_mutation(
  input: ProjectPrefilterMutationInput,
): ProjectPrefilterMutationOutput {
  const file_type_by_path = new Map<string, string>();
  for (const value of Object.values(input.state.files)) {
    const file = normalize_file_record(value);
    if (file === null) {
      continue;
    }
    file_type_by_path.set(file.rel_path, file.file_type);
  }

  const item_index = new Map<number, RuntimeProjectItemRecord>();
  for (const value of Object.values(input.state.items)) {
    const item = normalize_runtime_project_item_record(value);
    if (item === null) {
      continue;
    }
    item_index.set(item.item_id, clone_runtime_project_item_record(item));
  }

  let rule_skipped = 0;
  let language_skipped = 0;
  let mtool_skipped = 0;
  let duplicated = 0;
  const kvjson_items_by_path = new Map<string, RuntimeProjectItemRecord[]>();

  for (const item of item_index.values()) {
    if (
      item.status === "RULE_SKIPPED" ||
      item.status === "LANGUAGE_SKIPPED" ||
      item.status === "DUPLICATED"
    ) {
      item.status = "NONE";
    }
    if (input.mtool_optimizer_enable && file_type_by_path.get(item.file_path) === "KVJSON") {
      const current_group = kvjson_items_by_path.get(item.file_path);
      if (current_group === undefined) {
        kvjson_items_by_path.set(item.file_path, [item]);
      } else {
        current_group.push(item);
      }
    }
  }

  for (const item of item_index.values()) {
    if (item.status !== "NONE") {
      continue;
    }
    if (should_skip_by_rule_filter(item.src)) {
      item.status = "RULE_SKIPPED";
      rule_skipped += 1;
      continue;
    }
    if (should_skip_by_language_filter(item.src, input.source_language)) {
      item.status = "LANGUAGE_SKIPPED";
      language_skipped += 1;
    }
  }

  if (input.mtool_optimizer_enable) {
    for (const file_items of kvjson_items_by_path.values()) {
      const target_clauses = new Set<string>();
      for (const item of file_items) {
        if (item.src.includes("\n")) {
          for (const line of item.src.split(/\r\n|\r|\n/gu)) {
            const normalized_line = line.trim();
            if (normalized_line !== "") {
              target_clauses.add(normalized_line);
            }
          }
        }
      }

      for (const item of file_items) {
        if (item.status !== "NONE") {
          continue;
        }
        if (!target_clauses.has(item.src)) {
          continue;
        }
        item.status = "RULE_SKIPPED";
        mtool_skipped += 1;
      }
    }
  }

  if (input.skip_duplicate_source_text_enable) {
    const seen_src_by_file_path = new Map<string, Set<string>>();
    for (const item of item_index.values()) {
      const seen_src = seen_src_by_file_path.get(item.file_path) ?? new Set<string>();
      if (item.status === "NONE" && seen_src.has(item.src)) {
        item.status = "DUPLICATED";
        duplicated += 1;
      } else if (item.status === "NONE" || item.status === "PROCESSED") {
        seen_src.add(item.src);
      }
      seen_src_by_file_path.set(item.file_path, seen_src);
    }
  }

  const next_items: Record<string, Record<string, unknown>> = {};
  for (const item of item_index.values()) {
    next_items[String(item.item_id)] = {
      item_id: item.item_id,
      file_path: item.file_path,
      row_number: item.row_number,
      src: item.src,
      dst: item.dst,
      name_dst: item.name_dst ?? null,
      status: item.status,
      text_type: item.text_type,
      retry_count: item.retry_count,
    };
  }

  const derived_task_state = build_translation_task_and_project_state({
    task_snapshot: input.state.task,
    items: item_index,
    analysis_candidate_count: 0,
  });

  return {
    items: next_items,
    analysis: {
      extras: {},
      candidate_count: 0,
      candidate_aggregate: {},
      status_summary: build_analysis_status_summary(item_index.values()),
    },
    translation_extras: derived_task_state.translation_extras,
    task_snapshot: derived_task_state.task_snapshot,
    project_settings: {
      source_language: input.source_language,
      target_language: input.target_language ?? "",
      mtool_optimizer_enable: input.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: input.skip_duplicate_source_text_enable,
    },
    prefilter_config: {
      source_language: input.source_language,
      mtool_optimizer_enable: input.mtool_optimizer_enable,
      skip_duplicate_source_text_enable: input.skip_duplicate_source_text_enable,
    },
    stats: {
      rule_skipped,
      language_skipped,
      mtool_skipped,
      duplicated,
    },
  };
}
