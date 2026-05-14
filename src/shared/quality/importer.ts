import type { JsonRecord } from "../utils/json-tool";

export const QUALITY_RULE_IMPORT_RULE_TYPES = [
  "GLOSSARY",
  "PRE_REPLACEMENT",
  "POST_REPLACEMENT",
  "TEXT_PRESERVE",
] as const;

export type QualityRuleImportRuleType = (typeof QUALITY_RULE_IMPORT_RULE_TYPES)[number];

export const QualityRuleImportRuleTypeValue = {
  GLOSSARY: "GLOSSARY",
  PRE_REPLACEMENT: "PRE_REPLACEMENT",
  POST_REPLACEMENT: "POST_REPLACEMENT",
  TEXT_PRESERVE: "TEXT_PRESERVE",
} as const satisfies Record<QualityRuleImportRuleType, QualityRuleImportRuleType>;

export type QualityRuleImportAction = "skip" | "overwrite";

// 重复分类只描述 src 已撞 key 后的目标字段关系，供 UI 或测试判断风险语义
export type QualityRuleImportDuplicateKind =
  | "same-target"
  | "existing-target-empty"
  | "incoming-target-empty"
  | "different-target";

// incoming_index 指向本次导入条目，existing_indexes 指向当前项目中被撞到的旧规则
export type QualityRuleImportDuplicate = {
  incoming_index: number;
  existing_indexes: number[];
  key: string;
  kind: QualityRuleImportDuplicateKind;
};

// 手动导入预览同时产出“跳过”和“覆盖”两份快照，页面确认后只选择其一写入
export type QualityRuleImportPreview = {
  rule_type: QualityRuleImportRuleType;
  duplicate_count: number;
  non_duplicate_count: number;
  skipped_duplicate_count: number;
  duplicates: QualityRuleImportDuplicate[];
  skip_entries: JsonRecord[];
  overwrite_entries: JsonRecord[];
};

// 自动导入仍只补空字段；它共享 key 与 normalize 语义，但不进入用户确认流程
export type QualityRuleFillEmptyImportPreview = {
  merged_entries: JsonRecord[];
  entries: Array<{
    entry: JsonRecord;
    is_new: boolean;
    incoming_indexes: number[];
  }>;
  report: {
    added: number;
    filled: number;
  };
};

type QualityRuleImportMode = "OVERWRITE" | "FILL_EMPTY";

type QualityRuleImportItem = {
  entry: JsonRecord;
  src_norm: string;
  src_fold: string;
  case_sensitive: boolean;
  order: number;
  is_existing: boolean;
  incoming_index: number | null;
};

type DuplicateIndexItem = {
  index: number;
  entry: JsonRecord;
  src_norm: string;
  src_fold: string;
  case_sensitive: boolean;
};

type DuplicateKeyGroup = {
  key: string;
  existing_items: DuplicateIndexItem[];
  incoming_items: DuplicateIndexItem[];
};

type QualityRuleKeptEntry = {
  order: number;
  key: string;
  entry: JsonRecord;
  incoming_indexes: number[];
};

type QualityRuleImportMergeSnapshot = {
  merged_entries: JsonRecord[];
  entries: Array<{
    entry: JsonRecord;
    is_new: boolean;
    incoming_indexes: number[];
  }>;
  report: {
    added: number;
    filled: number;
  };
};

/**
 * 创建手动批量导入预览，页面只消费结果和重复计数，不再自行实现质量规则 key。
 */
export function preview_quality_rule_import(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
}): QualityRuleImportPreview {
  const groups = build_duplicate_key_groups(args);
  const duplicates = collect_duplicate_entries(args.rule_type, groups);
  const duplicate_index_set = new Set(duplicates.map((duplicate) => duplicate.incoming_index));
  const skip_incoming = args.incoming.filter((_entry, index) => !duplicate_index_set.has(index));
  const skip_result = merge_quality_rule_import_entries({
    rule_type: args.rule_type,
    existing: args.existing,
    incoming: skip_incoming,
    mode: "OVERWRITE",
  });
  const overwrite_result = merge_quality_rule_import_entries({
    rule_type: args.rule_type,
    existing: args.existing,
    incoming: args.incoming,
    mode: "OVERWRITE",
  });

  return {
    rule_type: args.rule_type,
    duplicate_count: duplicates.length,
    non_duplicate_count: Math.max(0, args.incoming.length - duplicates.length),
    skipped_duplicate_count: duplicates.length,
    duplicates,
    skip_entries: skip_result.merged_entries,
    overwrite_entries: overwrite_result.merged_entries,
  };
}

/**
 * 自动候选导入只补空字段；它复用同一共享归宿，但不触发三按钮确认流。
 */
export function preview_quality_rule_fill_empty_import(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
}): QualityRuleFillEmptyImportPreview {
  return merge_quality_rule_import_entries({
    rule_type: args.rule_type,
    existing: args.existing,
    incoming: args.incoming,
    mode: "FILL_EMPTY",
  });
}

function merge_quality_rule_import_entries(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
  mode: QualityRuleImportMode;
}): QualityRuleImportMergeSnapshot {
  const existing_items = ingest_import_rows(args.existing, {
    order_offset: 0,
    is_existing: true,
  });
  const incoming_items = ingest_import_rows(args.incoming, {
    order_offset: args.existing.length,
    is_existing: false,
  });
  const grouped_items = group_import_items_by_fold([...existing_items, ...incoming_items]);
  const existing_keys = collect_existing_keys(args.rule_type, grouped_items);
  const kept_entries = merge_grouped_import_entries(args, grouped_items);
  kept_entries.sort((left, right) => left.order - right.order);

  let added = 0;
  for (const entry of kept_entries) {
    if (!existing_keys.has(entry.key)) {
      added += 1;
    }
  }

  return {
    merged_entries: kept_entries.map((entry) => ({ ...entry.entry })),
    entries: kept_entries.map((entry) => ({
      entry: { ...entry.entry },
      is_new: !existing_keys.has(entry.key),
      incoming_indexes: [...entry.incoming_indexes],
    })),
    report: {
      added,
      filled: count_filled_import_entries(args, grouped_items),
    },
  };
}

function ingest_import_rows(
  rows: JsonRecord[],
  options: { order_offset: number; is_existing: boolean },
): QualityRuleImportItem[] {
  return rows.flatMap((raw_entry, index) => {
    if (!is_record(raw_entry)) {
      return [];
    }

    const entry = normalize_quality_rule_import_entry(raw_entry);
    const src_norm = String(entry["src"] ?? "");
    if (src_norm === "") {
      return [];
    }

    return [
      {
        entry,
        src_norm,
        src_fold: fold_quality_rule_import_src(src_norm),
        case_sensitive: Boolean(entry["case_sensitive"] ?? false),
        order: options.order_offset + index,
        is_existing: options.is_existing,
        incoming_index: options.is_existing ? null : index,
      },
    ];
  });
}

function group_import_items_by_fold(
  items: QualityRuleImportItem[],
): Map<string, QualityRuleImportItem[]> {
  const grouped_items = new Map<string, QualityRuleImportItem[]>();
  for (const item of items) {
    const group = grouped_items.get(item.src_fold);
    if (group === undefined) {
      grouped_items.set(item.src_fold, [item]);
    } else {
      group.push(item);
    }
  }
  return grouped_items;
}

function collect_existing_keys(
  rule_type: QualityRuleImportRuleType,
  grouped_items: Map<string, QualityRuleImportItem[]>,
): Set<string> {
  const existing_keys = new Set<string>();
  for (const [src_fold, items] of grouped_items) {
    // key 策略只与规则类型及 case_sensitive 语义有关，regex 不参与判重
    const fold_only = should_use_fold_only_key(rule_type, items);
    if (fold_only) {
      if (items.some((item) => item.is_existing)) {
        existing_keys.add(src_fold);
      }
      continue;
    }

    for (const item of items) {
      if (item.is_existing) {
        existing_keys.add(build_norm_key(src_fold, item.src_norm));
      }
    }
  }
  return existing_keys;
}

function merge_grouped_import_entries(
  args: {
    rule_type: QualityRuleImportRuleType;
    mode: QualityRuleImportMode;
  },
  grouped_items: Map<string, QualityRuleImportItem[]>,
): QualityRuleKeptEntry[] {
  const kept_entries: QualityRuleKeptEntry[] = [];
  for (const [src_fold, raw_items] of grouped_items) {
    const items = [...raw_items].sort((left, right) => left.order - right.order);
    if (should_use_fold_only_key(args.rule_type, items)) {
      const base = { ...items[0].entry };
      for (const item of items.slice(1)) {
        merge_import_entry_into_base({
          rule_type: args.rule_type,
          mode: args.mode,
          base,
          other: item.entry,
        });
      }
      kept_entries.push({
        order: items[0].order,
        key: src_fold,
        entry: base,
        incoming_indexes: collect_incoming_indexes(items),
      });
      continue;
    }

    const by_norm = new Map<string, QualityRuleImportItem[]>();
    for (const item of items) {
      const group = by_norm.get(item.src_norm);
      if (group === undefined) {
        by_norm.set(item.src_norm, [item]);
      } else {
        group.push(item);
      }
    }

    for (const [src_norm, norm_items] of by_norm) {
      const base = { ...norm_items[0].entry };
      for (const item of norm_items.slice(1)) {
        merge_import_entry_into_base({
          rule_type: args.rule_type,
          mode: args.mode,
          base,
          other: item.entry,
        });
      }
      kept_entries.push({
        order: norm_items[0].order,
        key: build_norm_key(src_fold, src_norm),
        entry: base,
        incoming_indexes: collect_incoming_indexes(norm_items),
      });
    }
  }
  return kept_entries;
}

function merge_import_entry_into_base(args: {
  rule_type: QualityRuleImportRuleType;
  mode: QualityRuleImportMode;
  base: JsonRecord;
  other: JsonRecord;
}): boolean {
  if (args.mode === "OVERWRITE") {
    return overwrite_import_entry_into_base(args.rule_type, args.base, args.other);
  }
  return fill_empty_import_entry_into_base(args.rule_type, args.base, args.other);
}

function overwrite_import_entry_into_base(
  rule_type: QualityRuleImportRuleType,
  base: JsonRecord,
  other: JsonRecord,
): boolean {
  let changed = false;
  const other_src = normalize_quality_rule_import_src(other["src"]);
  if (other_src !== "" && base["src"] !== other_src) {
    base["src"] = other_src;
    changed = true;
  }

  for (const field of get_overwrite_fields(rule_type)) {
    if (field === "dst" || field === "info") {
      const next_value = read_text(other, field);
      if (read_text(base, field) !== next_value) {
        base[field] = next_value;
        changed = true;
      }
      continue;
    }

    const next_value = read_flag(other, field);
    if (read_flag(base, field) !== next_value) {
      base[field] = next_value;
      changed = true;
    }
  }
  return changed;
}

function fill_empty_import_entry_into_base(
  rule_type: QualityRuleImportRuleType,
  base: JsonRecord,
  other: JsonRecord,
): boolean {
  let filled = false;
  for (const field of get_fill_empty_fields(rule_type)) {
    const current_value = read_text(base, field);
    const next_value = read_text(other, field);
    if (current_value === "" && next_value !== "") {
      base[field] = next_value;
      filled = true;
    }
  }
  return filled;
}

function count_filled_import_entries(
  args: {
    rule_type: QualityRuleImportRuleType;
    mode: QualityRuleImportMode;
  },
  grouped_items: Map<string, QualityRuleImportItem[]>,
): number {
  if (args.mode !== "FILL_EMPTY") {
    return 0;
  }

  let filled = 0;
  for (const raw_items of grouped_items.values()) {
    const items = [...raw_items].sort((left, right) => left.order - right.order);
    const buckets = should_use_fold_only_key(args.rule_type, items)
      ? [items]
      : [...bucket_items_by_norm(items).values()];
    for (const bucket of buckets) {
      const base = { ...bucket[0].entry };
      for (const item of bucket.slice(1)) {
        if (fill_empty_import_entry_into_base(args.rule_type, base, item.entry)) {
          filled += 1;
        }
      }
    }
  }
  return filled;
}

function bucket_items_by_norm(
  items: QualityRuleImportItem[],
): Map<string, QualityRuleImportItem[]> {
  const by_norm = new Map<string, QualityRuleImportItem[]>();
  for (const item of items) {
    const group = by_norm.get(item.src_norm);
    if (group === undefined) {
      by_norm.set(item.src_norm, [item]);
    } else {
      group.push(item);
    }
  }
  return by_norm;
}

function build_duplicate_key_groups(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
}): DuplicateKeyGroup[] {
  const existing_items = normalize_duplicate_index_items(args.existing);
  const incoming_items = normalize_duplicate_index_items(args.incoming);
  const groups_by_fold = new Map<string, DuplicateIndexItem[]>();

  for (const item of [...existing_items, ...incoming_items]) {
    const group = groups_by_fold.get(item.src_fold);
    if (group === undefined) {
      groups_by_fold.set(item.src_fold, [item]);
    } else {
      group.push(item);
    }
  }

  const groups: DuplicateKeyGroup[] = [];
  for (const [src_fold, folded_items] of groups_by_fold) {
    // 同折叠组内只要存在大小写不敏感规则，就整体按 fold key 判重
    const fold_only = should_use_fold_only_key(args.rule_type, folded_items);
    if (fold_only) {
      groups.push({
        key: src_fold,
        existing_items: existing_items.filter((item) => item.src_fold === src_fold),
        incoming_items: incoming_items.filter((item) => item.src_fold === src_fold),
      });
      continue;
    }

    const norm_values = new Set(folded_items.map((item) => item.src_norm));
    for (const src_norm of norm_values) {
      groups.push({
        key: build_norm_key(src_fold, src_norm),
        existing_items: existing_items.filter((item) => {
          return item.src_fold === src_fold && item.src_norm === src_norm;
        }),
        incoming_items: incoming_items.filter((item) => {
          return item.src_fold === src_fold && item.src_norm === src_norm;
        }),
      });
    }
  }
  return groups;
}

function normalize_duplicate_index_items(entries: JsonRecord[]): DuplicateIndexItem[] {
  return entries.flatMap((raw_entry, index) => {
    if (!is_record(raw_entry)) {
      return [];
    }

    const entry = normalize_quality_rule_import_entry(raw_entry);
    const src_norm = normalize_quality_rule_import_src(entry["src"]);
    if (src_norm === "") {
      return [];
    }

    return [
      {
        index,
        entry,
        src_norm,
        src_fold: fold_quality_rule_import_src(src_norm),
        case_sensitive: Boolean(entry["case_sensitive"] ?? false),
      },
    ];
  });
}

function collect_duplicate_entries(
  rule_type: QualityRuleImportRuleType,
  groups: DuplicateKeyGroup[],
): QualityRuleImportDuplicate[] {
  const duplicates: QualityRuleImportDuplicate[] = [];
  for (const group of groups) {
    if (group.existing_items.length === 0) {
      continue;
    }

    for (const incoming_item of group.incoming_items) {
      duplicates.push({
        incoming_index: incoming_item.index,
        existing_indexes: group.existing_items.map((item) => item.index),
        key: group.key,
        kind: classify_duplicate_kind(rule_type, group.existing_items, incoming_item.entry),
      });
    }
  }
  return duplicates.sort((left, right) => left.incoming_index - right.incoming_index);
}

function classify_duplicate_kind(
  rule_type: QualityRuleImportRuleType,
  existing_items: DuplicateIndexItem[],
  incoming_entry: JsonRecord,
): QualityRuleImportDuplicateKind {
  const incoming_target = read_target_text(rule_type, incoming_entry);
  const existing_targets = existing_items.map((item) => read_target_text(rule_type, item.entry));
  if (existing_targets.every((target) => target === incoming_target)) {
    return "same-target";
  }
  if (existing_targets.some((target) => target === "") && incoming_target !== "") {
    return "existing-target-empty";
  }
  if (incoming_target === "" && existing_targets.some((target) => target !== "")) {
    return "incoming-target-empty";
  }
  return "different-target";
}

function should_use_fold_only_key(
  rule_type: QualityRuleImportRuleType,
  items: Array<{ case_sensitive: boolean }>,
): boolean {
  return rule_type === "TEXT_PRESERVE" || items.some((item) => !item.case_sensitive);
}

function normalize_quality_rule_import_src(src: unknown): string {
  return typeof src === "string" ? src.trim() : "";
}

function fold_quality_rule_import_src(src_norm: string): string {
  // JavaScript 没有 Python str.casefold，显式补齐常见大小写折叠差异，避免规则 key 因 ß 变体分裂
  return src_norm.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLocaleLowerCase();
}

function normalize_quality_rule_import_entry(entry: JsonRecord): JsonRecord {
  return {
    ...entry,
    src: normalize_quality_rule_import_src(entry["src"]),
    dst: String(entry["dst"] ?? "").trim(),
    info: String(entry["info"] ?? "").trim(),
    regex: Boolean(entry["regex"] ?? false),
    case_sensitive: Boolean(entry["case_sensitive"] ?? false),
  };
}

function get_overwrite_fields(rule_type: QualityRuleImportRuleType) {
  return rule_type === "TEXT_PRESERVE"
    ? (["info"] as const)
    : rule_type === "GLOSSARY"
      ? (["dst", "info", "case_sensitive"] as const)
      : (["dst", "regex", "case_sensitive"] as const);
}

function get_fill_empty_fields(rule_type: QualityRuleImportRuleType) {
  return rule_type === "TEXT_PRESERVE"
    ? (["info"] as const)
    : rule_type === "GLOSSARY"
      ? (["dst", "info"] as const)
      : (["dst"] as const);
}

function collect_incoming_indexes(items: QualityRuleImportItem[]): number[] {
  return [
    ...new Set(
      items.flatMap((item) => (item.incoming_index === null ? [] : [item.incoming_index])),
    ),
  ].sort((left, right) => left - right);
}

function read_target_text(rule_type: QualityRuleImportRuleType, entry: JsonRecord): string {
  const field = rule_type === "TEXT_PRESERVE" ? "info" : "dst";
  return String(entry[field] ?? "").trim();
}

function build_norm_key(src_fold: string, src_norm: string): string {
  return `${src_fold}::${src_norm}`;
}

function read_text(record: JsonRecord, field: string): string {
  return String(record[field] ?? "").trim();
}

function read_flag(record: JsonRecord, field: string): boolean {
  return Boolean(record[field] ?? false);
}

function is_record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
