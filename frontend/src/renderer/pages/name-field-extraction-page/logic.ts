import type { GlossaryEntry } from "@/pages/glossary-page/types";
import type {
  NameFieldFilterState,
  NameFieldRow,
  NameFieldSortState,
  NameFieldStatus,
} from "@/pages/name-field-extraction-page/types";

type RuntimeItemRecord = {
  item_id: number;
  src: string;
  name_src: string | string[] | null;
};

type NameFieldExtractionGroup = {
  src: string;
  context: string;
};

const TRANSLATED_STATUSES = new Set<NameFieldStatus>(["translated"]);

function normalize_text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize_name_values(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(normalize_text).filter((name) => name !== "");
  }

  const name = normalize_text(value);
  return name === "" ? [] : [name];
}

function normalize_runtime_item_record(value: unknown): RuntimeItemRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const item_id = Number(candidate.item_id ?? candidate.id ?? 0);
  if (!Number.isFinite(item_id)) {
    return null;
  }

  const src = normalize_text(candidate.src);
  if (src === "") {
    return null;
  }

  return {
    item_id,
    src,
    name_src: candidate.name_src as string | string[] | null,
  };
}

function build_glossary_dst_by_src(entries: Array<Record<string, unknown>>): Map<string, string> {
  const dst_by_src = new Map<string, string>();
  for (const entry of entries) {
    const src = normalize_text(entry.src);
    const dst = normalize_text(entry.dst);
    if (src === "" || dst === "") {
      continue;
    }

    dst_by_src.set(src, dst);
  }
  return dst_by_src;
}

export function extract_name_field_rows(args: {
  items: Record<string, unknown>;
  glossary_entries: Array<Record<string, unknown>>;
}): NameFieldRow[] {
  const groups = new Map<string, NameFieldExtractionGroup>();
  const glossary_dst_by_src = build_glossary_dst_by_src(args.glossary_entries);

  for (const value of Object.values(args.items)) {
    const item = normalize_runtime_item_record(value);
    if (item === null) {
      continue;
    }

    for (const name of normalize_name_values(item.name_src)) {
      const current = groups.get(name);
      if (current === undefined || item.src.length > current.context.length) {
        groups.set(name, {
          src: name,
          context: item.src,
        });
      }
    }
  }

  return [...groups.values()]
    .sort((left_row, right_row) => left_row.src.localeCompare(right_row.src, "zh-Hans-CN"))
    .map((group) => {
      const dst = glossary_dst_by_src.get(group.src) ?? "";
      return {
        id: group.src,
        src: group.src,
        dst,
        context: group.context,
        status: dst === "" ? "untranslated" : "translated",
      };
    });
}

export function resolve_name_field_status_from_dst(dst: string): NameFieldStatus {
  return normalize_text(dst) === "" ? "untranslated" : "translated";
}

export function update_name_field_row_dst(
  rows: NameFieldRow[],
  row_id: string,
  dst: string,
): NameFieldRow[] {
  return rows.map((row) => {
    if (row.id !== row_id) {
      return row;
    }

    return {
      ...row,
      dst,
      status: resolve_name_field_status_from_dst(dst),
    };
  });
}

function build_filter_matcher(filter_state: NameFieldFilterState): (value: string) => boolean {
  const keyword = filter_state.keyword.trim();
  if (keyword === "") {
    return () => true;
  }

  if (filter_state.is_regex) {
    const regex = new RegExp(keyword, "iu");
    return (value) => regex.test(value);
  }

  const folded_keyword = keyword.toLocaleLowerCase();
  return (value) => value.toLocaleLowerCase().includes(folded_keyword);
}

export function get_name_field_filter_error(filter_state: NameFieldFilterState): string | null {
  if (!filter_state.is_regex || filter_state.keyword.trim() === "") {
    return null;
  }

  try {
    new RegExp(filter_state.keyword, "iu");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid regular expression";
  }
}

export function filter_name_field_rows(args: {
  rows: NameFieldRow[];
  filter_state: NameFieldFilterState;
  sort_state: NameFieldSortState;
}): NameFieldRow[] {
  if (get_name_field_filter_error(args.filter_state) !== null) {
    return args.rows;
  }

  const matches = build_filter_matcher(args.filter_state);
  const filtered_rows = args.rows.filter((row) => {
    if (args.filter_state.scope === "src") {
      return matches(row.src);
    }
    if (args.filter_state.scope === "dst") {
      return matches(row.dst);
    }
    return matches(row.src) || matches(row.dst);
  });

  if (args.sort_state.field === null || args.sort_state.direction === null) {
    return filtered_rows;
  }

  const direction = args.sort_state.direction === "ascending" ? 1 : -1;
  return [...filtered_rows].sort((left_row, right_row) => {
    const field = args.sort_state.field;
    if (field === "index" || field === null) {
      return 0;
    }

    return direction * left_row[field].localeCompare(right_row[field], "zh-Hans-CN");
  });
}

export function delete_name_field_rows(rows: NameFieldRow[], row_ids: string[]): NameFieldRow[] {
  if (row_ids.length === 0) {
    return rows;
  }

  const row_id_set = new Set(row_ids);
  return rows.filter((row) => !row_id_set.has(row.id));
}

export function build_name_field_glossary_entries(rows: NameFieldRow[]): GlossaryEntry[] {
  return rows
    .map((row) => {
      return {
        src: normalize_text(row.src),
        dst: normalize_text(row.dst),
        info: "",
        case_sensitive: false,
      };
    })
    .filter((entry) => entry.src !== "");
}

export function preserve_name_field_row_translations(args: {
  previous_rows: NameFieldRow[];
  extracted_rows: NameFieldRow[];
}): NameFieldRow[] {
  const previous_dst_by_src = new Map<string, string>();
  for (const row of args.previous_rows) {
    const src = normalize_text(row.src);
    const dst = normalize_text(row.dst);
    if (src !== "" && dst !== "") {
      previous_dst_by_src.set(src, dst);
    }
  }

  return args.extracted_rows.map((row) => {
    const previous_dst = previous_dst_by_src.get(row.src);
    if (previous_dst === undefined) {
      return row;
    }

    return {
      ...row,
      dst: previous_dst,
      status: "translated",
    };
  });
}

export function parse_name_field_translation_result(raw_text: string): {
  dst: string;
  status: NameFieldStatus;
} {
  const normalized_text = normalize_text(raw_text);
  const bracket_match = normalized_text.match(/【([^】]+)】/u);
  if (bracket_match?.[1] !== undefined) {
    return {
      dst: bracket_match[1].trim(),
      status: "translated",
    };
  }

  if (normalized_text !== "" && normalized_text.length <= 64 && !normalized_text.includes("\n")) {
    return {
      dst: normalized_text,
      status: "translated",
    };
  }

  return {
    dst: "",
    status: "format-error",
  };
}

export function count_name_field_rows(rows: NameFieldRow[]): {
  total: number;
  translated: number;
  untranslated: number;
  error: number;
} {
  return {
    total: rows.length,
    translated: rows.filter((row) => TRANSLATED_STATUSES.has(row.status)).length,
    untranslated: rows.filter((row) => row.status === "untranslated").length,
    error: rows.filter((row) => row.status === "format-error" || row.status === "network-error")
      .length,
  };
}
