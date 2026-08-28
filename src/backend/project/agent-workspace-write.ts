import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { Item, type ItemNameField } from "../../domain/item";
import { read_json_integer, type JsonRecord, type JsonValue } from "../../domain/json";
import { PROMPT_KINDS, type PromptKind } from "../../domain/prompt";
import { QualityRule, QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import { read_optional_item_name_text } from "../../shared/item-name";
import {
  collect_quality_rule_duplicate_groups,
  QualityRuleImportRuleTypeValue,
  type QualityRuleImportRuleType,
} from "../../shared/quality/quality-rule-import";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  apply_proofreading_item_update,
  are_proofreading_item_write_fields_equal,
  type ProofreadingItemUpdateFields,
} from "../proofreading/proofreading-item-update";
import type { ProjectItemWriteChange } from "./project-write-request";

export const AGENT_WORKSPACE_ITEM_FIELDS = Object.freeze([
  "item_id",
  "fp",
  "src",
  "dst",
  "name_src",
  "name_dst",
  "file_path",
  "text_type",
  "row_number",
  "status",
  "retry_count",
] as const);

export const AGENT_WORKSPACE_ITEM_WRITABLE_FIELDS = Object.freeze([
  "dst",
  "name_dst",
  "status",
] as const);

export const AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS = Object.freeze({
  glossary: ["src", "dst", "info", "case_sensitive"],
  text_preserve: ["src", "info"],
  pre_replacement: ["src", "dst", "regex", "case_sensitive"],
  post_replacement: ["src", "dst", "regex", "case_sensitive"],
} as const satisfies Record<QualityRuleKind, readonly string[]>);

export type AgentWorkspaceRejectionReason =
  | "invalid_change"
  | "fp_mismatch"
  | "target_missing"
  | "merge_conflict"
  | "dependency_conflict";

export type AgentWorkspaceRejectedChange = JsonRecord & {
  scope: "items" | "quality" | "prompts";
  op: "create" | "update" | "delete";
  reason: AgentWorkspaceRejectionReason;
};

export type AgentWorkspaceItemUpdateIntent = Readonly<{
  line: number;
  item_id: number;
  fp: string;
  update: ProofreadingItemUpdateFields;
}>;

export type AgentWorkspacePromptUpdateIntent = Readonly<{
  line: number;
  kind: PromptKind;
  fp: string;
  text: string;
}>;

export type AgentWorkspaceQualityCreateIntent = Readonly<{
  line: number;
  kind: QualityRuleKind;
  fields: JsonRecord;
  sort: number;
}>;

export type AgentWorkspaceQualityUpdateIntent = Readonly<{
  line: number;
  kind: QualityRuleKind;
  id: string;
  fp: string;
  fields: JsonRecord;
  sort?: number;
}>;

export type AgentWorkspaceQualityDeleteIntent = Readonly<{
  line: number;
  kind: QualityRuleKind;
  id: string;
  fp: string;
}>;

export type AgentWorkspaceQualityIntents = Readonly<{
  creates: readonly AgentWorkspaceQualityCreateIntent[];
  updates: readonly AgentWorkspaceQualityUpdateIntent[];
  deletes: readonly AgentWorkspaceQualityDeleteIntent[];
}>;

export type AgentWorkspaceIntentBatch = Readonly<{
  items: readonly AgentWorkspaceItemUpdateIntent[];
  prompts: readonly AgentWorkspacePromptUpdateIntent[];
  quality: Readonly<Record<QualityRuleKind, AgentWorkspaceQualityIntents>>;
}>;

export type AgentWorkspaceCurrentFacts = Readonly<{
  items: readonly JsonRecord[];
  quality: Partial<Record<QualityRuleKind, readonly JsonRecord[]>>;
  prompts: Partial<Record<PromptKind, string>>;
}>;

export type AgentWorkspaceQualitySummary = Readonly<{
  created: number;
  updated: number;
  deleted: number;
}>;

export type AgentWorkspaceAppliedSummary = Readonly<{
  items?: Readonly<{ updated: number }>;
  quality?: Partial<Record<QualityRuleKind, AgentWorkspaceQualitySummary>>;
  prompts?: Readonly<{ updated: PromptKind[] }>;
}>;

export type AgentWorkspaceQualityWrite = Readonly<{
  kind: QualityRuleKind;
  entries: readonly JsonRecord[];
}>;

export type AgentWorkspacePromptWrite = Readonly<{
  kind: PromptKind;
  text: string;
}>;

export type AgentWorkspaceWriteResolution = Readonly<{
  itemChanges: ProjectItemWriteChange[];
  qualityChanges: AgentWorkspaceQualityWrite[];
  promptChanges: AgentWorkspacePromptWrite[];
  applied: AgentWorkspaceAppliedSummary;
  rejected: AgentWorkspaceRejectedChange[];
  candidates: AgentWorkspaceIntentBatch;
}>;

const DUPLICATE_RULE_TYPE_BY_KIND = Object.freeze({
  glossary: QualityRuleImportRuleTypeValue.GLOSSARY,
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
  text_preserve: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
} satisfies Record<QualityRuleKind, QualityRuleImportRuleType>);

/** 构造四类 quality kind 均存在的空意图批次，供 parser、测试与调用方复用。 */
export function create_empty_agent_workspace_intent_batch(): AgentWorkspaceIntentBatch {
  return {
    items: [],
    prompts: [],
    quality: Object.fromEntries(
      QUALITY_RULE_KINDS.map((kind) => [kind, { creates: [], updates: [], deletes: [] }]),
    ) as unknown as Record<QualityRuleKind, AgentWorkspaceQualityIntents>,
  };
}

/** 把数据库 item 归一为工作区公开字段，并绑定对象事实指纹。 */
export function project_agent_workspace_item(item: JsonRecord): JsonRecord {
  const row: JsonRecord = {
    item_id: read_json_integer(item["item_id"] ?? item["id"], 0),
    src: String(item["src"] ?? ""),
    dst: String(item["dst"] ?? ""),
    name_src: read_optional_item_name_text(item["name_src"]) ?? "",
    name_dst: read_optional_item_name_text(item["name_dst"]) ?? "",
    file_path: String(item["file_path"] ?? ""),
    text_type: Item.normalize_text_type(item["text_type"]),
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
  return { item_id: row["item_id"], fp: fingerprint(item_fingerprint_tuple(row)), ...row };
}

/** 把 quality entry 的内部身份与业务字段投影为带当前位置的工作区对象。 */
export function project_agent_workspace_quality_entry(
  kind: QualityRuleKind,
  entry: JsonRecord,
  sort: number,
): JsonRecord {
  const row = project_quality_business_entry(kind, entry);
  return {
    id: row["id"],
    fp: fingerprint(quality_fingerprint_tuple(kind, row)),
    sort,
    ...Object.fromEntries(
      AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind].map((field) => [field, row[field]]),
    ),
  };
}

/** prompt 指纹同时绑定 kind 与正文，避免不同提示词共享同一事实身份。 */
export function project_agent_workspace_prompt(kind: PromptKind, text: string): JsonRecord {
  return { fp: fingerprint(["prompt", kind, text]), text };
}

/** 对当前对象事实重放整批意图，返回实际写入、拒绝与可提交候选。 */
export function resolve_agent_workspace_writes(args: {
  batch: AgentWorkspaceIntentBatch;
  current: AgentWorkspaceCurrentFacts;
  createQualityEntryId?: (entryIds: Set<string>) => string;
}): AgentWorkspaceWriteResolution {
  const item_result = resolve_items(args.batch.items, args.current.items);
  const prompt_result = resolve_prompts(args.batch.prompts, args.current.prompts);
  const quality_results = QUALITY_RULE_KINDS.map((kind) =>
    resolve_quality_kind({
      kind,
      intents: args.batch.quality[kind],
      current: args.current.quality[kind] ?? [],
      createEntryId: args.createQualityEntryId,
    }),
  );
  const quality_changes = quality_results.flatMap((result) =>
    result.summary === null ? [] : [{ kind: result.kind, entries: result.entries }],
  );
  const quality_summary = Object.fromEntries(
    quality_results.flatMap((result) =>
      result.summary === null ? [] : [[result.kind, result.summary]],
    ),
  ) as Partial<Record<QualityRuleKind, AgentWorkspaceQualitySummary>>;
  const prompt_kinds = prompt_result.changes.map((change) => change.kind);
  return {
    itemChanges: item_result.changes,
    qualityChanges: quality_changes,
    promptChanges: prompt_result.changes,
    applied: {
      ...(item_result.changes.length === 0
        ? {}
        : { items: { updated: item_result.changes.length } }),
      ...(quality_changes.length === 0 ? {} : { quality: quality_summary }),
      ...(prompt_kinds.length === 0 ? {} : { prompts: { updated: prompt_kinds } }),
    },
    rejected: [
      ...item_result.rejected,
      ...quality_results.flatMap((result) => result.rejected),
      ...prompt_result.rejected,
    ],
    candidates: {
      items: item_result.candidates,
      prompts: prompt_result.candidates,
      quality: Object.fromEntries(
        quality_results.map((result) => [result.kind, result.candidates]),
      ) as Record<QualityRuleKind, AgentWorkspaceQualityIntents>,
    },
  };
}

/** applied 只在至少一个领域存在真实变化时非空。 */
export function has_agent_workspace_applied_changes(
  summary: AgentWorkspaceAppliedSummary,
): boolean {
  return Object.keys(summary).length > 0;
}

/** status 完全由真实 applied 与 rejected 组合推导，调用方不能覆盖。 */
export function derive_agent_workspace_apply_status(
  applied: AgentWorkspaceAppliedSummary,
  rejected: readonly AgentWorkspaceRejectedChange[],
): "applied" | "partial" | "rejected" | "unchanged" {
  const has_applied = has_agent_workspace_applied_changes(applied);
  if (has_applied && rejected.length > 0) return "partial";
  if (has_applied) return "applied";
  return rejected.length > 0 ? "rejected" : "unchanged";
}

/** 指纹是工作区会话内的短冲突令牌，不作为持久身份或安全摘要。 */
function fingerprint(tuple: JsonValue[]): string {
  return createHash("sha256")
    .update(JsonTool.stringifyStrict(tuple))
    .digest()
    .subarray(0, 4)
    .toString("base64url");
}

function item_fingerprint_tuple(row: JsonRecord): JsonValue[] {
  return [
    "item",
    row["item_id"] ?? null,
    row["src"] ?? "",
    row["dst"] ?? "",
    row["name_src"] ?? "",
    row["name_dst"] ?? "",
    row["file_path"] ?? "",
    row["text_type"] ?? "NONE",
    row["row_number"] ?? 0,
    row["status"] ?? "NONE",
    row["retry_count"] ?? 0,
  ];
}

function quality_fingerprint_tuple(kind: QualityRuleKind, row: JsonRecord): JsonValue[] {
  return [
    "quality",
    kind,
    row["id"] ?? "",
    ...AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind].map((field) => row[field] ?? null),
  ];
}

function project_quality_business_entry(kind: QualityRuleKind, entry: JsonRecord): JsonRecord {
  const normalized = normalize_quality_rule_entries(QualityRule.from_json(kind), [entry])[0];
  if (normalized === undefined) throw new TypeError("Quality rule entry is missing.");
  return {
    id: normalized.entry_id,
    ...Object.fromEntries(
      AGENT_WORKSPACE_QUALITY_BUSINESS_FIELDS[kind].map((field) => [
        field,
        (normalized as unknown as JsonRecord)[field] ?? null,
      ]),
    ),
  };
}

/** 同一 item 的互补字段可合并，异值字段与对象漂移按 item 整体拒绝。 */
function resolve_items(
  intents: readonly AgentWorkspaceItemUpdateIntent[],
  current_items: readonly JsonRecord[],
): {
  changes: ProjectItemWriteChange[];
  rejected: AgentWorkspaceRejectedChange[];
  candidates: AgentWorkspaceItemUpdateIntent[];
} {
  const current_by_id = new Map(
    current_items.map((item) => [read_json_integer(item["item_id"] ?? item["id"], 0), item]),
  );
  const groups = group_by(intents, (intent) => intent.item_id);
  const changes: ProjectItemWriteChange[] = [];
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const candidates: AgentWorkspaceItemUpdateIntent[] = [];
  for (const [item_id, group] of groups) {
    const current = current_by_id.get(item_id);
    if (current === undefined) {
      rejected.push(item_rejection(item_id, "target_missing"));
      continue;
    }
    const current_fp = String(project_agent_workspace_item(current)["fp"]);
    if (group.some((intent) => intent.fp !== current_fp)) {
      rejected.push(item_rejection(item_id, "fp_mismatch"));
      continue;
    }
    const update = merge_fields(group.map((intent) => intent.update));
    if (update === null) {
      rejected.push(item_rejection(item_id, "merge_conflict"));
      continue;
    }
    const next = apply_proofreading_item_update(current as ItemWriteFacts, update);
    if (are_proofreading_item_write_fields_equal(current as ItemWriteFacts, next)) continue;
    changes.push({
      item_id,
      current: pick_item_write_fields(current),
      next: pick_item_write_fields(next as unknown as JsonRecord),
    });
    candidates.push({
      line: Math.min(...group.map((intent) => intent.line)),
      item_id,
      fp: current_fp,
      update,
    });
  }
  return { changes, rejected, candidates };
}

type ItemWriteFacts = JsonRecord & {
  dst: string;
  name_dst: ItemNameField;
  status: string;
  retry_count: number;
};

function pick_item_write_fields(item: JsonRecord): ProjectItemWriteChange["current"] {
  return {
    dst: String(item["dst"] ?? ""),
    name_dst: Item.normalize_name_field(item["name_dst"]),
    status: Item.normalize_status(item["status"]),
    retry_count: read_json_integer(item["retry_count"], 0),
  };
}

/** 同 kind prompt 的同值行去重，异值行按对象冲突处理。 */
function resolve_prompts(
  intents: readonly AgentWorkspacePromptUpdateIntent[],
  current: Partial<Record<PromptKind, string>>,
): {
  changes: AgentWorkspacePromptWrite[];
  rejected: AgentWorkspaceRejectedChange[];
  candidates: AgentWorkspacePromptUpdateIntent[];
} {
  const groups = group_by(intents, (intent) => intent.kind);
  const changes: AgentWorkspacePromptWrite[] = [];
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const candidates: AgentWorkspacePromptUpdateIntent[] = [];
  for (const kind of PROMPT_KINDS) {
    const group = groups.get(kind);
    if (group === undefined) continue;
    const text = current[kind];
    if (text === undefined) {
      rejected.push(prompt_rejection(kind, "target_missing"));
      continue;
    }
    const current_fp = String(project_agent_workspace_prompt(kind, text)["fp"]);
    if (group.some((intent) => intent.fp !== current_fp)) {
      rejected.push(prompt_rejection(kind, "fp_mismatch"));
      continue;
    }
    const values = new Set(group.map((intent) => intent.text));
    if (values.size > 1) {
      rejected.push(prompt_rejection(kind, "merge_conflict"));
      continue;
    }
    const next = group[0]?.text;
    if (next === undefined || next === text) continue;
    changes.push({ kind, text: next });
    candidates.push({
      line: Math.min(...group.map((intent) => intent.line)),
      kind,
      fp: current_fp,
      text: next,
    });
  }
  return { changes, rejected, candidates };
}

/** 一个 quality kind 内完成目标校验、依赖拒绝、排序重放与实际变化汇总。 */
function resolve_quality_kind(args: {
  kind: QualityRuleKind;
  intents: AgentWorkspaceQualityIntents;
  current: readonly JsonRecord[];
  createEntryId?: (entryIds: Set<string>) => string;
}): {
  kind: QualityRuleKind;
  entries: JsonRecord[];
  summary: AgentWorkspaceQualitySummary | null;
  rejected: AgentWorkspaceRejectedChange[];
  candidates: AgentWorkspaceQualityIntents;
} {
  const current = normalize_quality_rule_entries(
    QualityRule.from_json(args.kind),
    args.current,
  ) as JsonRecord[];
  const current_by_id = new Map(current.map((entry) => [read_entry_id(entry), entry]));
  const current_fp = new Map(
    current.map((entry, sort) => [
      read_entry_id(entry),
      String(project_agent_workspace_quality_entry(args.kind, entry, sort)["fp"]),
    ]),
  );
  const rejected: AgentWorkspaceRejectedChange[] = [];
  const rejected_delete_ids = new Set<string>();
  const deletes = new Map<string, AgentWorkspaceQualityDeleteIntent>();
  for (const [id, group] of group_by(args.intents.deletes, (intent) => intent.id)) {
    const reason = existing_target_rejection(group, current_by_id, current_fp);
    if (reason !== null) {
      rejected.push(quality_rejection(args.kind, "delete", id, reason));
      rejected_delete_ids.add(id);
      continue;
    }
    const first = group[0];
    if (first !== undefined) deletes.set(id, first);
  }

  const updates = new Map<string, AgentWorkspaceQualityUpdateIntent>();
  for (const [id, group] of group_by(args.intents.updates, (intent) => intent.id)) {
    // 同一 entry 的 delete 优先会让 update 失去明确目标，必须显式拒绝而不能静默丢弃。
    if (deletes.has(id)) {
      rejected.push(quality_rejection(args.kind, "update", id, "merge_conflict"));
      continue;
    }
    const reason = existing_target_rejection(group, current_by_id, current_fp);
    if (reason !== null) {
      rejected.push(quality_rejection(args.kind, "update", id, reason));
      continue;
    }
    const fields = merge_fields(group.map((intent) => intent.fields));
    const sorts = [
      ...new Set(group.flatMap((intent) => (intent.sort === undefined ? [] : [intent.sort]))),
    ];
    if (fields === null || sorts.length > 1) {
      rejected.push(quality_rejection(args.kind, "update", id, "merge_conflict"));
      continue;
    }
    const merged: AgentWorkspaceQualityUpdateIntent = {
      line: Math.min(...group.map((intent) => intent.line)),
      kind: args.kind,
      id,
      fp: current_fp.get(id) ?? "",
      fields,
      ...(sorts[0] === undefined ? {} : { sort: sorts[0] }),
    };
    try {
      const entry = current_by_id.get(id);
      normalize_quality_rule_entries(QualityRule.from_json(args.kind), [{ ...entry, ...fields }]);
      updates.set(id, merged);
    } catch {
      rejected.push(quality_rejection(args.kind, "update", id, "invalid_change"));
    }
  }

  const entry_ids = new Set(current_by_id.keys());
  let create_ids = new Map<AgentWorkspaceQualityCreateIntent, string>();
  const creates: AgentWorkspaceQualityCreateIntent[] = [];
  for (const intent of args.intents.creates) {
    const id = preview_entry_id(entry_ids, intent.line);
    try {
      normalize_quality_rule_entries(QualityRule.from_json(args.kind), [
        { entry_id: id, ...intent.fields },
      ]);
      create_ids.set(intent, id);
      creates.push(intent);
    } catch {
      rejected.push(quality_create_rejection(intent, "invalid_change"));
    }
  }

  let accepted_updates = updates;
  let accepted_creates = creates;
  let replay = replay_quality({
    kind: args.kind,
    current,
    deletes,
    updates: accepted_updates,
    creates: accepted_creates,
    createIds: create_ids,
  });
  const conflicts = expanded_duplicate_groups(args.kind, current, replay.entries);
  if (conflicts.length > 0) {
    const rejected_update_ids = new Set<string>();
    const rejected_create_ids = new Set<string>();
    for (const conflict of conflicts) {
      const dependency = conflict.ids.some((id) => rejected_delete_ids.has(id));
      for (const id of conflict.ids) {
        const update = accepted_updates.get(id);
        if (update !== undefined && !rejected_update_ids.has(id)) {
          rejected_update_ids.add(id);
          rejected.push(
            quality_rejection(
              args.kind,
              "update",
              id,
              dependency ? "dependency_conflict" : "invalid_change",
            ),
          );
        }
        if (replay.createById.has(id) && !rejected_create_ids.has(id)) {
          rejected_create_ids.add(id);
          const intent = replay.createById.get(id);
          if (intent !== undefined) {
            rejected.push(
              quality_create_rejection(
                intent,
                dependency ? "dependency_conflict" : "invalid_change",
              ),
            );
          }
        }
      }
    }
    accepted_updates = new Map(
      [...accepted_updates].filter(([id]) => !rejected_update_ids.has(id)),
    );
    accepted_creates = accepted_creates.filter(
      (intent) => !rejected_create_ids.has(create_ids.get(intent) ?? ""),
    );
    replay = replay_quality({
      kind: args.kind,
      current,
      deletes,
      updates: accepted_updates,
      creates: accepted_creates,
      createIds: create_ids,
    });
  }

  if (args.createEntryId !== undefined && accepted_creates.length > 0) {
    const actual_entry_ids = new Set(current_by_id.keys());
    create_ids = new Map(
      accepted_creates.map((intent) => [intent, args.createEntryId!(actual_entry_ids)]),
    );
    replay = replay_quality({
      kind: args.kind,
      current,
      deletes,
      updates: accepted_updates,
      creates: accepted_creates,
      createIds: create_ids,
    });
  }

  const summary = summarize_quality(
    current,
    replay.entries,
    accepted_updates,
    accepted_creates.length,
    deletes.size,
  );
  const real_update_ids = new Set(
    [...accepted_updates.values()]
      .filter((intent) => quality_target_changed(current, replay.entries, intent))
      .map((intent) => intent.id),
  );
  const real_updates = [...accepted_updates.values()].filter((intent) =>
    real_update_ids.has(intent.id),
  );
  const real_summary =
    summary.created === 0 && summary.updated === 0 && summary.deleted === 0 ? null : summary;
  return {
    kind: args.kind,
    entries: replay.entries,
    summary: real_summary,
    rejected,
    candidates: {
      creates: real_summary === null ? [] : accepted_creates,
      updates: real_summary === null ? [] : real_updates,
      deletes: real_summary === null ? [] : [...deletes.values()],
    },
  };
}

/** 先保留未显式排序的当前顺序，再稳定插入 sort 意图并执行领域归一化。 */
function replay_quality(args: {
  kind: QualityRuleKind;
  current: JsonRecord[];
  deletes: ReadonlyMap<string, AgentWorkspaceQualityDeleteIntent>;
  updates: ReadonlyMap<string, AgentWorkspaceQualityUpdateIntent>;
  creates: readonly AgentWorkspaceQualityCreateIntent[];
  createIds: ReadonlyMap<AgentWorkspaceQualityCreateIntent, string>;
}): { entries: JsonRecord[]; createById: Map<string, AgentWorkspaceQualityCreateIntent> } {
  const sorted_existing = new Set(
    [...args.updates.values()].flatMap((intent) => (intent.sort === undefined ? [] : [intent.id])),
  );
  const entries = args.current
    .filter((entry) => !args.deletes.has(read_entry_id(entry)))
    .map((entry) => {
      const update = args.updates.get(read_entry_id(entry));
      return update === undefined ? { ...entry } : { ...entry, ...update.fields };
    })
    .filter((entry) => !sorted_existing.has(read_entry_id(entry)));
  const create_by_id = new Map<string, AgentWorkspaceQualityCreateIntent>();
  const sortable: Array<{
    entry: JsonRecord;
    sort: number;
    type: 0 | 1;
    line: number;
  }> = [];
  for (const update of args.updates.values()) {
    if (update.sort === undefined) continue;
    const current = args.current.find((entry) => read_entry_id(entry) === update.id);
    if (current !== undefined) {
      sortable.push({
        entry: { ...current, ...update.fields },
        sort: update.sort,
        type: 0,
        line: update.line,
      });
    }
  }
  for (const intent of args.creates) {
    const id = args.createIds.get(intent);
    if (id === undefined) continue;
    create_by_id.set(id, intent);
    sortable.push({
      entry: { entry_id: id, ...intent.fields },
      sort: intent.sort,
      type: 1,
      line: intent.line,
    });
  }
  sortable.sort((left, right) => {
    if (left.sort === -1 && right.sort !== -1) return 1;
    if (right.sort === -1 && left.sort !== -1) return -1;
    return left.sort - right.sort || left.type - right.type || left.line - right.line;
  });
  for (let index = 0; index < sortable.length;) {
    const sort = sortable[index]?.sort ?? -1;
    const group: JsonRecord[] = [];
    while (index < sortable.length && sortable[index]?.sort === sort) {
      const entry = sortable[index]?.entry;
      if (entry !== undefined) group.push(entry);
      index += 1;
    }
    entries.splice(sort === -1 ? entries.length : Math.min(sort, entries.length), 0, ...group);
  }
  return {
    entries: normalize_quality_rule_entries(
      QualityRule.from_json(args.kind),
      entries,
    ) as JsonRecord[],
    createById: create_by_id,
  };
}

function summarize_quality(
  current: JsonRecord[],
  next: JsonRecord[],
  updates: ReadonlyMap<string, AgentWorkspaceQualityUpdateIntent>,
  created: number,
  deleted: number,
): AgentWorkspaceQualitySummary {
  const updated = [...updates.values()].filter((intent) =>
    quality_target_changed(current, next, intent),
  ).length;
  return { created, updated, deleted };
}

function quality_target_changed(
  current: JsonRecord[],
  next: JsonRecord[],
  intent: AgentWorkspaceQualityUpdateIntent,
): boolean {
  const before_index = current.findIndex((entry) => read_entry_id(entry) === intent.id);
  const after_index = next.findIndex((entry) => read_entry_id(entry) === intent.id);
  return (
    !isDeepStrictEqual(current[before_index], next[after_index]) ||
    (intent.sort !== undefined && before_index !== after_index)
  );
}

/** 只返回新增或扩大的重复组，既有重复事实本身不阻塞无关修改。 */
function expanded_duplicate_groups(
  kind: QualityRuleKind,
  current: JsonRecord[],
  next: JsonRecord[],
): Array<{ key: string; ids: string[] }> {
  const rule_type = DUPLICATE_RULE_TYPE_BY_KIND[kind];
  const previous = new Map(
    collect_quality_rule_duplicate_groups({ rule_type, entries: current }).map((group) => [
      group.key,
      group.indexes.length,
    ]),
  );
  return collect_quality_rule_duplicate_groups({ rule_type, entries: next })
    .filter((group) => group.indexes.length > (previous.get(group.key) ?? 1))
    .map((group) => ({
      key: group.key,
      ids: group.indexes.map((index) => read_entry_id(next[index] ?? {})),
    }));
}

function existing_target_rejection<T extends { id: string; fp: string }>(
  group: readonly T[],
  current: ReadonlyMap<string, JsonRecord>,
  fingerprints: ReadonlyMap<string, string>,
): "target_missing" | "fp_mismatch" | null {
  const id = group[0]?.id ?? "";
  if (!current.has(id)) return "target_missing";
  return group.some((intent) => intent.fp !== fingerprints.get(id)) ? "fp_mismatch" : null;
}

/** 合并互补字段；同字段出现不同值时返回 null 表示对象级冲突。 */
function merge_fields<T extends object>(values: readonly T[]): T | null {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    for (const [field, next] of Object.entries(value)) {
      if (Object.hasOwn(merged, field) && !isDeepStrictEqual(merged[field], next)) return null;
      merged[field] = next;
    }
  }
  return merged as T;
}

function group_by<T, TKey>(values: readonly T[], key: (value: T) => TKey): Map<TKey, T[]> {
  const groups = new Map<TKey, T[]>();
  for (const value of values) {
    const value_key = key(value);
    const group = groups.get(value_key);
    if (group === undefined) groups.set(value_key, [value]);
    else group.push(value);
  }
  return groups;
}

/** 预演 ID 只需在当前 kind 内稳定且无冲突，事务提交时会替换为真实 ID。 */
function preview_entry_id(entry_ids: Set<string>, line: number): string {
  let suffix = 0;
  let id = `__agent_preview_${line.toString()}`;
  while (entry_ids.has(id)) {
    suffix += 1;
    id = `__agent_preview_${line.toString()}_${suffix.toString()}`;
  }
  entry_ids.add(id);
  return id;
}

function read_entry_id(entry: JsonRecord): string {
  return String(entry["entry_id"] ?? "");
}

function item_rejection(
  id: number,
  reason: AgentWorkspaceRejectionReason,
): AgentWorkspaceRejectedChange {
  return { scope: "items", op: "update", id, reason };
}

function prompt_rejection(
  kind: PromptKind,
  reason: AgentWorkspaceRejectionReason,
): AgentWorkspaceRejectedChange {
  return { scope: "prompts", op: "update", kind, reason };
}

function quality_rejection(
  kind: QualityRuleKind,
  op: "update" | "delete",
  id: string,
  reason: AgentWorkspaceRejectionReason,
): AgentWorkspaceRejectedChange {
  return { scope: "quality", kind, op, id, reason };
}

function quality_create_rejection(
  intent: AgentWorkspaceQualityCreateIntent,
  reason: AgentWorkspaceRejectionReason,
): AgentWorkspaceRejectedChange {
  const src = intent.fields["src"];
  return {
    scope: "quality",
    kind: intent.kind,
    op: "create",
    ...(typeof src === "string" && src !== "" ? { src } : { line: intent.line }),
    reason,
  };
}
