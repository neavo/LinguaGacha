import {
  run_quality_statistics_task_sync,
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
  type QualityStatisticsRuleMode,
} from "../../../shared/quality/quality-statistics";
import {
  build_legacy_quality_rule_entry_id,
  normalize_quality_rule_entry_id,
} from "../../../shared/quality/quality-rule-entry-id";

export type QualityStatisticsWorkerTaskInput = {
  rule_key: QualityStatisticsRuleMode;
  entries: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
};

export function run_quality_statistics_worker_task(
  input: QualityStatisticsWorkerTaskInput,
): Record<string, unknown> {
  const rule_key = input.rule_key;
  const src_texts = input.items.map((item) => String(item["src"] ?? ""));
  const dst_texts = input.items.map((item) => String(item["dst"] ?? ""));
  const rules = build_quality_statistics_rules(rule_key, input.entries);
  const relation_candidates = build_quality_relation_candidates(rules);
  const statistics_result = run_quality_statistics_task_sync({
    rules,
    srcTexts: src_texts,
    dstTexts: dst_texts,
    relationCandidates: relation_candidates,
  });
  const completed_entry_ids = rules.map((rule) => rule.key);
  const matched_count_by_entry_id = Object.fromEntries(
    completed_entry_ids.map((entry_id) => {
      return [entry_id, statistics_result.results[entry_id]?.matched_item_count ?? 0];
    }),
  );
  const subset_parent_labels_by_entry_id = Object.fromEntries(
    completed_entry_ids.map((entry_id) => {
      return [entry_id, statistics_result.results[entry_id]?.subset_parents ?? []];
    }),
  );
  const completed_snapshot = build_quality_statistics_dependency_snapshot(
    rule_key,
    rules,
    rule_key === "post_replacement" ? dst_texts : src_texts,
  );
  return {
    phase: "current",
    current_snapshot: completed_snapshot,
    completed_snapshot,
    completed_entry_ids,
    matched_count_by_entry_id,
    subset_parent_labels_by_entry_id,
    last_error: null,
    request_token: 0,
    updated_at: Date.now(),
  };
}

function build_quality_statistics_rules(
  rule_key: QualityStatisticsRuleMode,
  entries: unknown[],
): QualityStatisticsRuleInput[] {
  return entries.flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const pattern = String(record["src"] ?? "");
    if (pattern.trim() === "") {
      return [];
    }
    return [
      {
        key: build_quality_entry_id(record, index),
        pattern,
        mode: rule_key,
        regex: rule_key === "text_preserve" ? true : Boolean(record["regex"]),
        case_sensitive: Boolean(record["case_sensitive"]),
      },
    ];
  });
}

function build_quality_relation_candidates(
  rules: QualityStatisticsRuleInput[],
): QualityStatisticsRelationCandidate[] {
  return rules.map((rule) => {
    return {
      key: rule.key,
      src: rule.pattern,
    };
  });
}

function build_quality_statistics_dependency_snapshot(
  rule_key: QualityStatisticsRuleMode,
  rules: QualityStatisticsRuleInput[],
  texts: string[],
): QualityStatisticsDependencySnapshot {
  const text_signature = build_quality_text_signature(texts);
  const snapshot_rules = rules.map((rule) => {
    const dependency_signature = JSON.stringify([
      rule.mode,
      rule.pattern,
      Boolean(rule.regex),
      Boolean(rule.case_sensitive),
    ]);
    return {
      key: rule.key,
      dependency_signature,
      relation_label: rule.pattern,
      token: `${dependency_signature}:${rule.key}`,
    };
  });
  const dependency_signature = JSON.stringify({
    text_source: rule_key === "post_replacement" ? "dst" : "src",
    text_signature,
    tokens: snapshot_rules.map((rule) => rule.token),
  });

  return {
    text_source: rule_key === "post_replacement" ? "dst" : "src",
    text_signature,
    dependency_signature,
    snapshot_signature: JSON.stringify({
      dependency_signature,
      keys: snapshot_rules.map((rule) => rule.key),
    }),
    rules: snapshot_rules,
  };
}

function build_quality_text_signature(texts: string[]): string {
  let hash = 2166136261;
  for (const [index, text] of texts.entries()) {
    const framed_text = `${index.toString()}:${text.length.toString()}:${text}`;
    for (let char_index = 0; char_index < framed_text.length; char_index += 1) {
      hash ^= framed_text.charCodeAt(char_index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${texts.length.toString()}:${hash.toString(36)}`;
}

function build_quality_entry_id(entry: Record<string, unknown>, index: number): string {
  const entry_id = normalize_quality_rule_entry_id(entry["entry_id"]);
  if (entry_id !== null) {
    return entry_id;
  }
  return build_legacy_quality_rule_entry_id(entry, index);
}
