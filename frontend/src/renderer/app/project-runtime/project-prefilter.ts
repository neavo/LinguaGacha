import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  build_analysis_status_summary,
  build_translation_task_and_project_state,
  clone_runtime_project_item_record,
  normalize_runtime_project_item_record,
  type RuntimeProjectItemRecord,
} from "@/app/project-runtime/reset-derived";

type ProjectPrefilterFileRecord = {
  rel_path: string;
  file_type: string;
};

type ProjectPrefilterStats = {
  rule_skipped: number;
  language_skipped: number;
  mtool_skipped: number;
};

export type ProjectPrefilterMutationOutput = {
  items: Record<string, Record<string, unknown>>;
  analysis: Record<string, unknown>;
  translation_extras: Record<string, unknown>;
  project_status: string;
  task_snapshot: Record<string, unknown>;
  prefilter_config: {
    source_language: string;
    mtool_optimizer_enable: boolean;
  };
  stats: ProjectPrefilterStats;
};

export type ProjectPrefilterMutationInput = {
  state: ProjectStoreState;
  source_language: string;
  mtool_optimizer_enable: boolean;
};

const RULE_FILTER_PREFIXES = ["mapdata/", "se/", "bgs", "0=", "bgm/", "ficon/"];

const RULE_FILTER_SUFFIXES = [
  ".mp3",
  ".wav",
  ".ogg",
  ".mid",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".psd",
  ".webp",
  ".heif",
  ".heic",
  ".avi",
  ".mp4",
  ".webm",
  ".txt",
  ".7z",
  ".gz",
  ".rar",
  ".zip",
  ".json",
  ".sav",
  ".mps",
  ".ttf",
  ".otf",
  ".woff",
];

const RULE_FILTER_PATTERNS = [
  /^EV\d+$/iu,
  /^DejaVu Sans$/iu,
  /^Opendyslexic$/iu,
  /^\{#file_time\}/iu,
];

const SPECIAL_PUNCTUATION_SET = new Set(["·", "・", "♥"]);

function normalize_file_record(value: unknown): ProjectPrefilterFileRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  return {
    rel_path: String((value as ProjectPrefilterFileRecord).rel_path ?? ""),
    file_type: String((value as ProjectPrefilterFileRecord).file_type ?? "NONE"),
  };
}

function is_punctuation_character(char: string): boolean {
  return /\p{P}/u.test(char) || SPECIAL_PUNCTUATION_SET.has(char);
}

function should_rule_filter(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/gu);
  const flags: boolean[] = [];
  for (const raw_line of lines) {
    const line = raw_line.trim().toLowerCase();
    if (line === "") {
      flags.push(true);
      continue;
    }

    const all_numeric_or_punctuation = [...line].every((char) => {
      return /\s/u.test(char) || /\p{N}/u.test(char) || is_punctuation_character(char);
    });
    if (all_numeric_or_punctuation) {
      flags.push(true);
      continue;
    }

    if (RULE_FILTER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      flags.push(true);
      continue;
    }

    if (RULE_FILTER_SUFFIXES.some((suffix) => line.endsWith(suffix))) {
      flags.push(true);
      continue;
    }

    if (RULE_FILTER_PATTERNS.some((pattern) => pattern.test(line))) {
      flags.push(true);
      continue;
    }

    flags.push(false);
  }

  return flags.length > 0 && flags.every(Boolean);
}

function has_target_language_character(text: string, source_language: string): boolean {
  switch (source_language) {
    case "ALL":
      return true;
    case "ZH":
      return /\p{Script=Han}/u.test(text);
    case "JA":
      return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
    case "KO":
      return /[\p{Script=Han}\p{Script=Hangul}]/u.test(text);
    case "RU":
      return /\p{Script=Cyrillic}/u.test(text);
    case "AR":
      return /\p{Script=Arabic}/u.test(text);
    case "TH":
      return /\p{Script=Thai}/u.test(text);
    default:
      return /\p{Script=Latin}/u.test(text);
  }
}

function should_language_filter(text: string, source_language: string): boolean {
  return !has_target_language_character(text, source_language);
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
  const kvjson_items_by_path = new Map<string, RuntimeProjectItemRecord[]>();

  for (const item of item_index.values()) {
    if (item.status === "RULE_SKIPPED" || item.status === "LANGUAGE_SKIPPED") {
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
    if (should_rule_filter(item.src)) {
      item.status = "RULE_SKIPPED";
      rule_skipped += 1;
      continue;
    }
    if (should_language_filter(item.src, input.source_language)) {
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
    project_status: derived_task_state.project_status,
    task_snapshot: derived_task_state.task_snapshot,
    prefilter_config: {
      source_language: input.source_language,
      mtool_optimizer_enable: input.mtool_optimizer_enable,
    },
    stats: {
      rule_skipped,
      language_skipped,
      mtool_skipped,
    },
  };
}
