type QualityRuleEntryWithId = {
  entry_id?: string;
  src?: unknown;
};

// entry_id 去空后为空即视为缺失。
function normalize_quality_rule_entry_id(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

// 新规则使用带领域前缀的随机 UUID，避免与迁移期稳定 ID 混淆。
export function create_quality_rule_entry_id(): string {
  return `qr:${crypto.randomUUID()}`;
}

// 旧规则没有 ID 时用原文和原始位置生成同批次内稳定身份。
export function build_legacy_quality_rule_entry_id(
  entry: QualityRuleEntryWithId,
  index: number,
): string {
  return `${String(entry.src ?? "").trim()}::${index.toString()}`;
}

function ensure_quality_rule_entry_id<Entry extends QualityRuleEntryWithId>(
  entry: Entry,
  index: number,
): Entry & { entry_id: string } {
  return {
    ...entry,
    entry_id:
      normalize_quality_rule_entry_id(entry.entry_id) ??
      build_legacy_quality_rule_entry_id(entry, index),
  };
}

// 批量补 ID 时保留已有合法身份，只为缺失项生成迁移期身份。
export function ensure_quality_rule_entry_ids<Entry extends QualityRuleEntryWithId>(
  entries: readonly Entry[],
): Array<Entry & { entry_id: string }> {
  const resolved_entries = entries.map((entry, index) => {
    return ensure_quality_rule_entry_id(entry, index);
  });
  const entry_ids = new Set<string>();
  for (const entry of resolved_entries) {
    if (entry_ids.has(entry.entry_id)) {
      throw new TypeError(`质量规则 entry_id 重复：${entry.entry_id}`);
    }
    entry_ids.add(entry.entry_id);
  }
  return resolved_entries;
}
