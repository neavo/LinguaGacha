import type { JsonRecord } from "../utils/json-tool";

// 合并模式来自 Py 侧 QualityRuleMerger，显式入口覆盖，隐式入口只补空。
export const QUALITY_RULE_MERGE_MODES = ["OVERWRITE", "FILL_EMPTY"] as const;

// 规则类型值保持与旧数据库 RuleType 语义一致，调用方负责从公开 kind 映射到这里。
export const QUALITY_RULE_MERGE_RULE_TYPES = [
  "GLOSSARY",
  "PRE_REPLACEMENT",
  "POST_REPLACEMENT",
  "TEXT_PRESERVE",
] as const;

export type QualityRuleMergeMode = (typeof QUALITY_RULE_MERGE_MODES)[number];

export type QualityRuleMergeRuleType = (typeof QUALITY_RULE_MERGE_RULE_TYPES)[number];

export type QualityRuleMergeConflict = {
  rule_type: QualityRuleMergeRuleType;
  key: string;
  field: string;
  existing: string | boolean;
  incoming: string | boolean;
};

export type QualityRuleMergeReport = {
  added: number;
  updated: number;
  filled: number;
  deduped: number;
  skipped_empty_src: number;
  conflicts: QualityRuleMergeConflict[];
};

export type QualityRuleMergePreviewEntry = {
  entry: JsonRecord;
  is_new: boolean;
  incoming_indexes: number[];
};

export type QualityRuleMergePreview = {
  merged: JsonRecord[];
  report: QualityRuleMergeReport;
  entries: QualityRuleMergePreviewEntry[];
};

type QualityRuleMergeItem = {
  entry: JsonRecord;
  src_norm: string;
  src_fold: string;
  case_sensitive: boolean;
  order: number;
  is_existing: boolean;
  incoming_index: number | null;
};

type QualityRuleKeptEntry = {
  order: number;
  key: string;
  entry: JsonRecord;
  incoming_indexes: number[];
};

export const QualityRuleMergeModeValue = {
  OVERWRITE: "OVERWRITE",
  FILL_EMPTY: "FILL_EMPTY",
} as const satisfies Record<QualityRuleMergeMode, QualityRuleMergeMode>;

export const QualityRuleMergeRuleTypeValue = {
  GLOSSARY: "GLOSSARY",
  PRE_REPLACEMENT: "PRE_REPLACEMENT",
  POST_REPLACEMENT: "POST_REPLACEMENT",
  TEXT_PRESERVE: "TEXT_PRESERVE",
} as const satisfies Record<QualityRuleMergeRuleType, QualityRuleMergeRuleType>;

/**
 * 标准化判重源文本；非字符串视为空，避免坏数据落入规则 key。
 */
export function normalize_quality_rule_merge_src(src: unknown): string {
  return typeof src === "string" ? src.trim() : "";
}

/**
 * 构建大小写折叠 key；合并判重统一走这里，避免页面和任务导入各自实现。
 */
export function fold_quality_rule_merge_src(src_norm: string): string {
  // JavaScript 没有 Python str.casefold，显式补齐常见大小写折叠差异，避免规则 key 因 ß 变体分裂。
  return src_norm.replaceAll("ẞ", "ss").replaceAll("ß", "ss").toLocaleLowerCase();
}

/**
 * 补齐合并所需核心字段，同时保留 entry_id 等页面字段。
 */
export function normalize_quality_rule_merge_entry(entry: JsonRecord): JsonRecord {
  return {
    ...entry,
    src: normalize_quality_rule_merge_src(entry["src"]),
    dst: String(entry["dst"] ?? "").trim(),
    info: String(entry["info"] ?? "").trim(),
    regex: Boolean(entry["regex"] ?? false),
    case_sensitive: Boolean(entry["case_sensitive"] ?? false),
  };
}

/**
 * 合并 existing 与 incoming，并返回可直接写回的条目列表和统计报告。
 */
export function merge_quality_rule_entries(args: {
  rule_type: QualityRuleMergeRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
  merge_mode?: QualityRuleMergeMode;
}): { merged: JsonRecord[]; report: QualityRuleMergeReport } {
  const preview = preview_quality_rule_merge(args);
  return {
    merged: preview.merged.map((entry) => ({ ...entry })),
    report: preview.report,
  };
}

/**
 * 合并预演会额外保留 incoming 下标，供分析导入过滤候选时一次删干净。
 */
export function preview_quality_rule_merge(args: {
  rule_type: QualityRuleMergeRuleType;
  existing: JsonRecord[];
  incoming: JsonRecord[];
  merge_mode?: QualityRuleMergeMode;
}): QualityRuleMergePreview {
  const merge_mode = args.merge_mode ?? "OVERWRITE";
  let skipped_empty_src = 0;

  const ingest = (
    rows: JsonRecord[],
    options: { order_offset: number; is_existing: boolean },
  ): QualityRuleMergeItem[] => {
    const items: QualityRuleMergeItem[] = [];
    rows.forEach((raw_entry, index) => {
      if (!is_record(raw_entry)) {
        return;
      }
      const entry = normalize_quality_rule_merge_entry(raw_entry);
      const src_norm = String(entry["src"] ?? "");
      if (src_norm === "") {
        skipped_empty_src += 1;
        return;
      }
      items.push({
        entry,
        src_norm,
        src_fold: fold_quality_rule_merge_src(src_norm),
        case_sensitive: Boolean(entry["case_sensitive"] ?? false),
        order: options.order_offset + index,
        is_existing: options.is_existing,
        incoming_index: options.is_existing ? null : index,
      });
    });
    return items;
  };

  const existing_items = ingest(args.existing, { order_offset: 0, is_existing: true });
  const incoming_items = ingest(args.incoming, {
    order_offset: args.existing.length,
    is_existing: false,
  });
  const grouped_items = new Map<string, QualityRuleMergeItem[]>();
  for (const item of [...existing_items, ...incoming_items]) {
    const group = grouped_items.get(item.src_fold);
    if (group === undefined) {
      grouped_items.set(item.src_fold, [item]);
    } else {
      group.push(item);
    }
  }

  const existing_keys = new Set<string>();
  for (const [src_fold, items] of grouped_items) {
    // key 策略只与规则类型及 case_sensitive 语义有关，regex 不参与判重。
    const fold_only =
      args.rule_type === "TEXT_PRESERVE" || items.some((item) => !item.case_sensitive);
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

  let added = 0;
  let updated = 0;
  let filled = 0;
  let deduped = 0;
  const conflicts: QualityRuleMergeConflict[] = [];
  const kept_entries: QualityRuleKeptEntry[] = [];

  const record_conflict = (conflict: Omit<QualityRuleMergeConflict, "rule_type">): void => {
    conflicts.push({
      rule_type: args.rule_type,
      ...conflict,
    });
  };

  const merge_into_base = (options: {
    base: JsonRecord;
    other: JsonRecord;
    key: string;
  }): { overwrite_changed: boolean; filled_changed: boolean } => {
    const { base, other, key } = options;
    let overwrite_changed = false;
    let filled_changed = false;

    if (merge_mode === "OVERWRITE") {
      // OVERWRITE 用于手动保存/导入，incoming 允许覆盖为空。
      const other_src = normalize_quality_rule_merge_src(other["src"]);
      if (other_src !== "" && base["src"] !== other_src) {
        base["src"] = other_src;
        overwrite_changed = true;
      }

      const fields =
        args.rule_type === "TEXT_PRESERVE"
          ? (["info"] as const)
          : args.rule_type === "GLOSSARY"
            ? (["dst", "info", "case_sensitive"] as const)
            : (["dst", "regex", "case_sensitive"] as const);

      for (const field of fields) {
        if (field === "dst" || field === "info") {
          const before = read_text(base, field);
          const after = read_text(other, field);
          if (before !== "" && after !== "" && before !== after) {
            record_conflict({
              key,
              field,
              existing: before,
              incoming: after,
            });
          }
          if (before !== after) {
            base[field] = after;
            overwrite_changed = true;
          }
          continue;
        }

        const before = read_flag(base, field);
        const after = read_flag(other, field);
        if (before !== after) {
          record_conflict({
            key,
            field,
            existing: before,
            incoming: after,
          });
          base[field] = after;
          overwrite_changed = true;
        }
      }
      return { overwrite_changed, filled_changed: false };
    }

    // FILL_EMPTY 用于自动术语表写回，只补文本空值，不改变 regex/case_sensitive 等行为开关。
    const fill_fields =
      args.rule_type === "TEXT_PRESERVE"
        ? (["info"] as const)
        : args.rule_type === "GLOSSARY"
          ? (["dst", "info"] as const)
          : (["dst"] as const);
    const protected_flags =
      args.rule_type === "TEXT_PRESERVE"
        ? ([] as const)
        : args.rule_type === "GLOSSARY"
          ? (["case_sensitive"] as const)
          : (["regex", "case_sensitive"] as const);

    for (const field of fill_fields) {
      const before = read_text(base, field);
      const after = read_text(other, field);
      if (before !== "" && after !== "" && before !== after) {
        record_conflict({
          key,
          field,
          existing: before,
          incoming: after,
        });
      }
      if (before === "" && after !== "") {
        base[field] = after;
        filled_changed = true;
      }
    }

    for (const field of protected_flags) {
      const before = read_flag(base, field);
      const after = read_flag(other, field);
      if (before !== after) {
        record_conflict({
          key,
          field,
          existing: before,
          incoming: after,
        });
      }
    }

    return { overwrite_changed: false, filled_changed };
  };

  for (const [src_fold, raw_items] of grouped_items) {
    const items = [...raw_items].sort((left, right) => left.order - right.order);
    const fold_only =
      args.rule_type === "TEXT_PRESERVE" || items.some((item) => !item.case_sensitive);

    if (fold_only) {
      const base = { ...items[0].entry };
      for (const item of items.slice(1)) {
        deduped += 1;
        const result = merge_into_base({ base, other: item.entry, key: src_fold });
        if (result.overwrite_changed) {
          updated += 1;
        }
        if (result.filled_changed) {
          filled += 1;
        }
      }
      kept_entries.push({
        order: items[0].order,
        key: src_fold,
        entry: base,
        incoming_indexes: collect_incoming_indexes(items),
      });
      continue;
    }

    const by_norm = new Map<string, QualityRuleMergeItem[]>();
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
      const key = build_norm_key(src_fold, src_norm);
      for (const item of norm_items.slice(1)) {
        deduped += 1;
        const result = merge_into_base({ base, other: item.entry, key });
        if (result.overwrite_changed) {
          updated += 1;
        }
        if (result.filled_changed) {
          filled += 1;
        }
      }
      kept_entries.push({
        order: norm_items[0].order,
        key,
        entry: base,
        incoming_indexes: collect_incoming_indexes(norm_items),
      });
    }
  }

  kept_entries.sort((left, right) => left.order - right.order);
  for (const entry of kept_entries) {
    if (!existing_keys.has(entry.key)) {
      added += 1;
    }
  }

  const report: QualityRuleMergeReport = {
    added,
    updated,
    filled,
    deduped,
    skipped_empty_src,
    conflicts,
  };
  return {
    merged: kept_entries.map((entry) => ({ ...entry.entry })),
    report,
    entries: kept_entries.map((entry) => ({
      entry: { ...entry.entry },
      is_new: !existing_keys.has(entry.key),
      incoming_indexes: [...entry.incoming_indexes],
    })),
  };
}

function collect_incoming_indexes(items: QualityRuleMergeItem[]): number[] {
  return [
    ...new Set(
      items.flatMap((item) => (item.incoming_index === null ? [] : [item.incoming_index])),
    ),
  ].sort((left, right) => left - right);
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
