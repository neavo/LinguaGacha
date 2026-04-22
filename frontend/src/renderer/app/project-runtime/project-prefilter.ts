import type { ProjectStoreState } from "@/app/project-runtime/project-store";

type ProjectPrefilterFileRecord = {
  rel_path: string;
  file_type: string;
};

type ProjectPrefilterItemRecord = {
  item_id: number;
  file_path: string;
  row_number: number;
  src: string;
  dst: string;
  name_dst: unknown;
  status: string;
  text_type: string;
  retry_count: number;
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

const TRACKED_TRANSLATION_STATUSES = new Set(["NONE", "PROCESSED", "ERROR"]);
const ANALYSIS_SKIPPED_STATUSES = new Set([
  "EXCLUDED",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "DUPLICATED",
]);

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

function normalize_item_record(value: unknown): ProjectPrefilterItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isInteger(item_id)) {
    return null;
  }

  return {
    item_id,
    file_path: String(candidate.file_path ?? ""),
    row_number: Number(candidate.row_number ?? candidate.row ?? 0),
    src: String(candidate.src ?? ""),
    dst: String(candidate.dst ?? ""),
    name_dst: candidate.name_dst ?? null,
    status: String(candidate.status ?? ""),
    text_type: String(candidate.text_type ?? "NONE"),
    retry_count: Number(candidate.retry_count ?? 0),
  };
}

function clone_item_record(item: ProjectPrefilterItemRecord): ProjectPrefilterItemRecord {
  return {
    ...item,
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

function build_translation_extras(task_snapshot: Record<string, unknown>): Record<string, unknown> {
  const translation_extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task_snapshot)) {
    if (
      key === "task_type" ||
      key === "status" ||
      key === "busy" ||
      key === "request_in_flight_count" ||
      key === "analysis_candidate_count"
    ) {
      continue;
    }
    translation_extras[key] = value;
  }
  return translation_extras;
}

function build_task_and_project_state(args: {
  task_snapshot: Record<string, unknown>;
  items: Map<number, ProjectPrefilterItemRecord>;
}): {
  translation_extras: Record<string, unknown>;
  project_status: string;
  task_snapshot: Record<string, unknown>;
} {
  let processed_line = 0;
  let error_line = 0;
  let total_line = 0;
  let has_pending = false;

  for (const item of args.items.values()) {
    if (item.status === "PROCESSED") {
      processed_line += 1;
    }
    if (item.status === "ERROR") {
      error_line += 1;
    }
    if (item.status === "NONE") {
      has_pending = true;
    }
    if (TRACKED_TRANSLATION_STATUSES.has(item.status)) {
      total_line += 1;
    }
  }

  const translation_extras = build_translation_extras(args.task_snapshot);
  translation_extras.processed_line = processed_line;
  translation_extras.error_line = error_line;
  translation_extras.total_line = total_line;
  translation_extras.line = processed_line + error_line;

  const project_status = total_line <= 0 ? "NONE" : has_pending ? "PROCESSING" : "PROCESSED";

  return {
    translation_extras,
    project_status,
    task_snapshot: {
      ...args.task_snapshot,
      ...translation_extras,
      analysis_candidate_count: 0,
    },
  };
}

function build_analysis_status_summary(
  items: Map<number, ProjectPrefilterItemRecord>,
): Record<string, unknown> {
  let total_line = 0;
  for (const item of items.values()) {
    if (item.src.trim() === "" || ANALYSIS_SKIPPED_STATUSES.has(item.status)) {
      continue;
    }
    total_line += 1;
  }

  return {
    total_line,
    processed_line: 0,
    error_line: 0,
    line: 0,
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

  const item_index = new Map<number, ProjectPrefilterItemRecord>();
  for (const value of Object.values(input.state.items)) {
    const item = normalize_item_record(value);
    if (item === null) {
      continue;
    }
    item_index.set(item.item_id, clone_item_record(item));
  }

  let rule_skipped = 0;
  let language_skipped = 0;
  let mtool_skipped = 0;
  const kvjson_items_by_path = new Map<string, ProjectPrefilterItemRecord[]>();

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

  const derived_task_state = build_task_and_project_state({
    task_snapshot: input.state.task,
    items: item_index,
  });

  return {
    items: next_items,
    analysis: {
      extras: {},
      candidate_count: 0,
      candidate_aggregate: {},
      status_summary: build_analysis_status_summary(item_index),
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
