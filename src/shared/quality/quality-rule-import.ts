import type { JsonRecord } from "../../domain/json";
import { normalize_literal_text } from "../text/literal-matcher";

const QUALITY_RULE_IMPORT_RULE_TYPES = [
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
type QualityRuleImportDuplicateKind =
  | "same-target"
  | "existing-target-empty"
  | "incoming-target-empty"
  | "different-target";

// incoming_index 指向本次导入条目，existing_indexes 指向当前项目中被撞到的旧规则
type QualityRuleImportDuplicate = {
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

export type QualityRuleDuplicateGroup = {
  key: string;
  indexes: number[];
};

/**
 * 按导入/GUI 的同一 key 规则找出现有列表内部重复项，供只读结构分析复用。
 */
export function collect_quality_rule_duplicate_groups(args: {
  rule_type: QualityRuleImportRuleType;
  entries: JsonRecord[];
}): QualityRuleDuplicateGroup[] {
  return build_duplicate_key_groups({
    rule_type: args.rule_type,
    existing: args.entries,
    incoming: [],
  })
    .filter((group) => group.existing_items.length > 1)
    .map((group) => ({
      key: group.key,
      indexes: group.existing_items.map((item) => item.index),
    }));
}

type QualityRuleImportItem = {
  index: number;
  entry: JsonRecord;
  identity: string;
  order: number;
};

type DuplicateKeyGroup = {
  key: string;
  existing_items: QualityRuleImportItem[];
  incoming_items: QualityRuleImportItem[];
};

type QualityRuleKeptEntry = {
  order: number;
  entry: JsonRecord;
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
  });
  const overwrite_result = merge_quality_rule_import_entries({
    rule_type: args.rule_type,
    existing: args.existing,
    incoming: args.incoming,
  });

  return {
    rule_type: args.rule_type,
    duplicate_count: duplicates.length,
    non_duplicate_count: Math.max(0, args.incoming.length - duplicates.length),
    skipped_duplicate_count: duplicates.length,
    duplicates,
    skip_entries: skip_result,
    overwrite_entries: overwrite_result,
  };
}

function merge_quality_rule_import_entries(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
}): JsonRecord[] {
  const existing_items = ingest_import_rows(args.rule_type, args.existing, {
    order_offset: 0,
  });
  const incoming_items = ingest_import_rows(args.rule_type, args.incoming, {
    order_offset: args.existing.length,
  });
  const grouped_items = group_import_items_by_identity([...existing_items, ...incoming_items]);
  const kept_entries = merge_grouped_import_entries(args.rule_type, grouped_items);
  kept_entries.sort((left, right) => left.order - right.order);

  return kept_entries.map((entry) => ({ ...entry.entry }));
}

// 同一归一化入口同时保留原数组索引和合并顺序，预览与最终快照共用。
function ingest_import_rows(
  rule_type: QualityRuleImportRuleType,
  rows: JsonRecord[],
  options: { order_offset: number },
): QualityRuleImportItem[] {
  return rows.flatMap((raw_entry, index) => {
    if (!is_record(raw_entry)) {
      return [];
    }

    const entry = normalize_quality_rule_import_entry(raw_entry);
    if (String(entry["src"] ?? "") === "") {
      return [];
    }

    return [
      {
        index,
        entry,
        identity: build_pattern_identity(rule_type, entry),
        order: options.order_offset + index,
      },
    ];
  });
}

function group_import_items_by_identity(
  items: QualityRuleImportItem[],
): Map<string, QualityRuleImportItem[]> {
  const grouped_items = new Map<string, QualityRuleImportItem[]>();
  for (const item of items) {
    const group = grouped_items.get(item.identity);
    if (group === undefined) {
      grouped_items.set(item.identity, [item]);
    } else {
      group.push(item);
    }
  }
  return grouped_items;
}

function merge_grouped_import_entries(
  rule_type: QualityRuleImportRuleType,
  grouped_items: Map<string, QualityRuleImportItem[]>,
): QualityRuleKeptEntry[] {
  const kept_entries: QualityRuleKeptEntry[] = [];
  for (const items of grouped_items.values()) {
    const base = { ...items[0].entry };
    for (const item of items.slice(1)) {
      overwrite_import_entry_into_base(rule_type, base, item.entry);
    }
    kept_entries.push({ order: items[0].order, entry: base });
  }
  return kept_entries;
}

// 覆盖动作只写当前规则类型允许的目标字段，避免携带未知导入元数据。
function overwrite_import_entry_into_base(
  rule_type: QualityRuleImportRuleType,
  base: JsonRecord,
  other: JsonRecord,
): void {
  for (const field of get_overwrite_fields(rule_type)) {
    const next_value = read_text(other, field);
    if (read_text(base, field) !== next_value) {
      base[field] = next_value;
    }
  }
}

// 判重键必须与实际合并键完全一致，否则预览计数会与确认后的结果分叉。
function build_duplicate_key_groups(args: {
  rule_type: QualityRuleImportRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
}): DuplicateKeyGroup[] {
  const existing_items = ingest_import_rows(args.rule_type, args.existing, { order_offset: 0 });
  const incoming_items = ingest_import_rows(args.rule_type, args.incoming, { order_offset: 0 });
  const existing_by_identity = group_import_items_by_identity(existing_items);
  const incoming_by_identity = group_import_items_by_identity(incoming_items);
  return [...new Set([...existing_by_identity.keys(), ...incoming_by_identity.keys()])].map(
    (identity) => ({
      key: identity,
      existing_items: existing_by_identity.get(identity) ?? [],
      incoming_items: incoming_by_identity.get(identity) ?? [],
    }),
  );
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
  existing_items: QualityRuleImportItem[],
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

function normalize_quality_rule_import_src(src: unknown): string {
  return typeof src === "string" ? src.trim() : "";
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
      ? (["dst", "info"] as const)
      : (["dst"] as const);
}

function read_target_text(rule_type: QualityRuleImportRuleType, entry: JsonRecord): string {
  const field = rule_type === "TEXT_PRESERVE" ? "info" : "dst";
  return String(entry[field] ?? "").trim();
}

function read_text(record: JsonRecord, field: string): string {
  return String(record[field] ?? "").trim();
}

function build_pattern_identity(rule_type: QualityRuleImportRuleType, entry: JsonRecord): string {
  const src = read_text(entry, "src");
  if (rule_type === "TEXT_PRESERVE") return JSON.stringify(["regex", false, src]);
  const regex = rule_type !== "GLOSSARY" && Boolean(entry["regex"]);
  const case_sensitive = Boolean(entry["case_sensitive"]);
  return JSON.stringify([
    regex ? "regex" : "literal",
    case_sensitive,
    regex ? src : normalize_literal_text(src, case_sensitive),
  ]);
}

function is_record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
