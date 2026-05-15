type QualityRuleEntryWithId = {
  entry_id?: string;
  src?: unknown;
};

let fallback_entry_id_sequence = 0;

export function normalize_quality_rule_entry_id(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

export function create_quality_rule_entry_id(): string {
  const random_id = globalThis.crypto?.randomUUID?.();
  if (typeof random_id === "string") {
    return `qr:${random_id}`;
  }

  fallback_entry_id_sequence += 1;
  return `qr:fallback:${Date.now().toString(36)}:${fallback_entry_id_sequence.toString(36)}`;
}

export function build_legacy_quality_rule_entry_id(
  entry: QualityRuleEntryWithId,
  index: number,
): string {
  return `${String(entry.src ?? "").trim()}::${index.toString()}`;
}

export function ensure_quality_rule_entry_id<Entry extends QualityRuleEntryWithId>(
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

export function ensure_quality_rule_entry_ids<Entry extends QualityRuleEntryWithId>(
  entries: Entry[],
): Array<Entry & { entry_id: string }> {
  return entries.map((entry, index) => {
    return ensure_quality_rule_entry_id(entry, index);
  });
}
