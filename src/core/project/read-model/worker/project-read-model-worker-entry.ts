import { parentPort } from "node:worker_threads";

import { to_log_error } from "../../../../shared/error";
import {
  count_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
  get_name_field_filter_error,
} from "../../../../shared/name-field-extraction/name-field-extraction";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
} from "../../../../shared/quality/quality-statistics";
import { build_ts_conversion_converted_items } from "../../../../shared/ts-conversion/ts-conversion";
import type {
  ProjectReadModelComputeQualityStatisticsMessage,
  ProjectReadModelWorkerIncomingMessage,
  ProjectReadModelWorkerOutgoingMessage,
} from "./project-read-model-worker-types";

const cancelled_ids = new Set<string>(); // 取消只影响对应消息，worker 生命周期由池管理。

function handle_message(message: ProjectReadModelWorkerIncomingMessage): void {
  if (message.type === "cancel") {
    cancelled_ids.add(message.id);
    return;
  }
  void execute_message(message);
}

async function execute_message(
  message: Exclude<ProjectReadModelWorkerIncomingMessage, { type: "cancel" }>,
): Promise<void> {
  try {
    const data = await execute_task(message);
    post_message({ id: message.id, ok: true, data });
  } catch (error) {
    post_message({
      id: message.id,
      ok: false,
      error: to_log_error(error, { worker_message_type: message.type }),
    });
  } finally {
    cancelled_ids.delete(message.id);
  }
}

async function execute_task(
  message: Exclude<ProjectReadModelWorkerIncomingMessage, { type: "cancel" }>,
) {
  assert_not_cancelled(message.id);
  if (message.type === "compute_quality_statistics") {
    return compute_quality_statistics(message);
  }
  if (message.type === "extract_name_fields") {
    const rows = extract_name_field_rows({
      items: message.input.items,
      glossary_entries: message.input.glossary_entries,
    });
    const filtered_rows = filter_name_field_rows({
      rows,
      filter_state: message.input.filter,
      sort_state: message.input.sort,
    });
    return {
      rows: filtered_rows,
      counts: count_name_field_rows(rows),
      invalid_regex_message: get_name_field_filter_error(message.input.filter),
    };
  }
  return build_ts_conversion_converted_items(message.input);
}

function compute_quality_statistics(
  message: ProjectReadModelComputeQualityStatisticsMessage,
): Record<string, unknown> {
  const rule_key = message.input.rule_key;
  const src_texts = message.input.items.map((item) => String(item["src"] ?? ""));
  const dst_texts = message.input.items.map((item) => String(item["dst"] ?? ""));
  const rules = build_quality_statistics_rules(rule_key, message.input.entries);
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
  rule_key: "glossary" | "pre_replacement" | "post_replacement" | "text_preserve",
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
  rule_key: "glossary" | "pre_replacement" | "post_replacement" | "text_preserve",
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
  const entry_id = String(entry["entry_id"] ?? "");
  if (entry_id !== "") {
    return entry_id;
  }
  return `${String(entry["src"] ?? "").trim()}::${index.toString()}`;
}

function assert_not_cancelled(id: string): void {
  if (cancelled_ids.has(id)) {
    throw new Error("项目 read model 计算已取消。");
  }
}

function post_message(message: ProjectReadModelWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

parentPort?.on("message", (message: ProjectReadModelWorkerIncomingMessage) => {
  handle_message(message);
});
