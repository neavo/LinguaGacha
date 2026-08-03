import { Type, type Static } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { read_json_integer, read_json_record } from "../../domain/json";
import {
  QUALITY_RULE_KINDS,
  QualityRule,
  TEXT_PRESERVE_MODES,
  type QualityRuleKind,
} from "../../domain/quality";
import { collect_quality_rule_duplicate_groups } from "../../shared/quality/quality-rule-import";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "../../shared/quality/quality-rule-entry-id";
import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { ResolvedGlossaryEntry } from "../../shared/quality/glossary";
import { read_item_name_text } from "../../shared/item-name";

/** 质量规则工具只公开四个稳定业务 kind，不接受数据库物理类型。 */
const RULE_TYPE_PARAMETERS = Type.Enum(QUALITY_RULE_KINDS, {
  type: "string",
  description: "决定 entry 和 meta 的适用字段。",
});

const CHANGE_ACTION_PARAMETERS = Type.Enum(["create", "update", "delete"], {
  type: "string",
  description: "create 需要 entry；update 需要 entry_id 和 entry；delete 只需要 entry_id。",
});

const TEXT_PRESERVE_MODE_PARAMETERS = Type.Enum(TEXT_PRESERVE_MODES, {
  type: "string",
  description: "仅 text_preserve 的 meta。",
});

/** 模型可见 entry 只表达可移植字段类型，规则种类关联由 Agent 入口收窄。 */
const QUALITY_RULE_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String({ description: "所有规则必填。" }),
    dst: Type.Optional(Type.String({ description: "glossary 和两类 replacement 必填。" })),
    info: Type.Optional(Type.String({ description: "glossary 和 text_preserve 必填。" })),
    regex: Type.Optional(Type.Boolean({ description: "仅两类 replacement 必填。" })),
    case_sensitive: Type.Optional(
      Type.Boolean({ description: "glossary 和两类 replacement 必填。" }),
    ),
  },
  { additionalProperties: false },
);

/** 增删改共享普通对象结构，action 的字段组合由 Agent 入口收窄。 */
const QUALITY_RULE_CHANGE_PARAMETERS = Type.Object(
  {
    action: CHANGE_ACTION_PARAMETERS,
    entry_id: Type.Optional(Type.String({ description: "只用于 update/delete，不得放入 entry。" })),
    entry: Type.Optional(QUALITY_RULE_ENTRY_PARAMETERS),
    before_entry_id: Type.Optional(
      // null 分支必须在前，避免 SDK 的 TypeBox 转换把 null 改为空字符串。
      Type.Union([Type.Null(), Type.String()], {
        description: "只用于 create/update；null 表示移到末尾。",
      }),
    ),
  },
  { additionalProperties: false },
);

/** meta 共享普通对象结构，规则种类关联由 Agent 入口收窄。 */
const QUALITY_RULE_META_PARAMETERS = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean({ description: "glossary 和两类 replacement 的 meta。" })),
    mode: Type.Optional(TEXT_PRESERVE_MODE_PARAMETERS),
  },
  { additionalProperties: false },
);

/** 质量写入只依赖 quality section revision。 */
const EXPECTED_QUALITY_REVISION_PARAMETERS = Type.Object(
  // number + multipleOf 避免 SDK 把小数先截断成 integer 再放行。
  { quality: Type.Number({ minimum: 0, multipleOf: 1 }) },
  { additionalProperties: false },
);

/** 查询入口只接收规则 kind。 */
const QUERY_QUALITY_RULES_PARAMETERS = Type.Object(
  { rule_type: RULE_TYPE_PARAMETERS },
  { additionalProperties: false },
);

/** 更新 schema 只表达跨供应商稳定的结构约束。 */
const UPDATE_QUALITY_RULES_PARAMETERS = Type.Object(
  {
    rule_type: RULE_TYPE_PARAMETERS,
    changes: Type.Optional(Type.Array(QUALITY_RULE_CHANGE_PARAMETERS)),
    meta: Type.Optional(QUALITY_RULE_META_PARAMETERS),
    expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
  },
  { additionalProperties: false },
);

type QualityRuleChange =
  | { action: "create"; entry: JsonRecord; before_entry_id?: string | null }
  | {
      action: "update";
      entry_id: string;
      entry: JsonRecord;
      before_entry_id?: string | null;
    }
  | { action: "delete"; entry_id: string };

type AgentQualityRuleUpdate = {
  rule_type: QualityRuleKind;
  changes: QualityRuleChange[];
  meta?: JsonRecord;
  expected_section_revisions: { quality: number };
};

type AgentQualityCache = {
  readonly items: Pick<CacheReadPort["items"], "readItems">;
};

type AgentQualityRules = Pick<QualityRuleService, "query" | "update_from_agent">;

type AgentQualityDependencies = {
  qualityRules: AgentQualityRules;
  cache: AgentQualityCache;
  computeWorker: Pick<ComputeWorkerClient, "run">;
};

/** Agent 发起的规则提交使用独立 source，确保项目事件保留真实来源。 */
export const AGENT_QUALITY_RULE_UPDATE_SOURCE = "agent_quality_rule_update";

/** 在读取项目快照前把宽 Schema 参数收窄为唯一可执行形状。 */
function read_agent_quality_rule_update(
  params: Static<typeof UPDATE_QUALITY_RULES_PARAMETERS>,
): AgentQualityRuleUpdate {
  const rule_type = QualityRule.from_json(params.rule_type).kind;
  const changes = (params.changes ?? []).map((change, index) =>
    read_agent_quality_rule_change(rule_type, change, index),
  );
  const meta =
    params.meta === undefined ? undefined : read_agent_quality_rule_meta(rule_type, params.meta);
  if (changes.length === 0 && meta === undefined) {
    throw new Error("质量规则更新至少需要 changes 或 meta");
  }
  return {
    rule_type,
    changes,
    ...(meta === undefined ? {} : { meta }),
    expected_section_revisions: params.expected_section_revisions,
  };
}

/** action 决定 change 的完整字段集合，读取后不再携带不可能状态。 */
function read_agent_quality_rule_change(
  rule_type: QualityRuleKind,
  value: unknown,
  index: number,
): QualityRuleChange {
  const change = read_json_record(value);
  const label = `第 ${(index + 1).toString()} 个 changes`;
  switch (change["action"]) {
    case "create":
      assert_fields(change, ["action", "entry"], ["before_entry_id"], label);
      return {
        action: "create",
        entry: read_agent_quality_rule_entry(rule_type, change["entry"], label),
        ...(Object.prototype.hasOwnProperty.call(change, "before_entry_id")
          ? { before_entry_id: change["before_entry_id"] as string | null }
          : {}),
      };
    case "update":
      assert_fields(change, ["action", "entry_id", "entry"], ["before_entry_id"], label);
      return {
        action: "update",
        entry_id: normalize_entry_id(change["entry_id"]),
        entry: read_agent_quality_rule_entry(rule_type, change["entry"], label),
        ...(Object.prototype.hasOwnProperty.call(change, "before_entry_id")
          ? { before_entry_id: change["before_entry_id"] as string | null }
          : {}),
      };
    case "delete":
      assert_fields(change, ["action", "entry_id"], [], label);
      return { action: "delete", entry_id: normalize_entry_id(change["entry_id"]) };
    default:
      throw new Error(`${label} 的 action 无效`);
  }
}

/** rule_type 决定 entry 必须且只能具有的完整替换字段。 */
function read_agent_quality_rule_entry(
  rule_type: QualityRuleKind,
  value: unknown,
  change_label: string,
): JsonRecord {
  const entry = read_json_record(value);
  const fields =
    rule_type === "glossary"
      ? ["src", "dst", "info", "case_sensitive"]
      : rule_type === "text_preserve"
        ? ["src", "info"]
        : ["src", "dst", "regex", "case_sensitive"];
  assert_fields(entry, fields, [], `${change_label} 的 entry`);
  return entry;
}

/** rule_type 决定 meta 的单一完整字段。 */
function read_agent_quality_rule_meta(rule_type: QualityRuleKind, value: unknown): JsonRecord {
  const meta = read_json_record(value);
  assert_fields(meta, [rule_type === "text_preserve" ? "mode" : "enabled"], [], "meta");
  return meta;
}

/** 条件协议只检查字段集合；类型、枚举和数值范围由 SDK Schema 校验。 */
function assert_fields(
  record: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown !== undefined) throw new Error(`${label} 包含未知字段：${unknown}`);
  const missing = required.find((field) => !Object.prototype.hasOwnProperty.call(record, field));
  if (missing !== undefined) throw new Error(`${label} 缺少必填字段：${missing}`);
}

/** 构造统一质量规则 query/update 工具；领域持久化仍由 QualityRuleService 拥有。 */
export function create_agent_quality_tools(
  dependencies: AgentQualityDependencies,
): ToolDefinition[] {
  return [
    defineTool({
      name: "query_quality_rules",
      label: "查询质量规则",
      description: "查询当前工程指定质量规则的完整有序条目、meta、事实分析和 revision。",
      parameters: QUERY_QUALITY_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return tool_result(
          await query_agent_quality_rules(
            dependencies,
            params.rule_type,
            signal ?? new AbortController().signal,
          ),
        );
      },
    }),
    defineTool({
      name: "update_quality_rules",
      label: "更新质量规则",
      description: "按 expected_section_revisions 原子应用质量规则增删改、重排和 meta 更新。",
      executionMode: "sequential",
      parameters: UPDATE_QUALITY_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const update = read_agent_quality_rule_update(params);
        const execution_signal = signal ?? new AbortController().signal;
        // 更新只读取规则结构；术语语料统计统一留给 prospective 集合，避免同一写入扫描两次。
        const current = read_agent_quality_rules_snapshot(
          dependencies.qualityRules,
          update.rule_type,
        );
        const applied =
          update.changes.length === 0
            ? undefined
            : apply_agent_quality_rule_changes({
                rule_type: update.rule_type,
                current_entries: current.entries,
                changes: update.changes,
              });
        if (update.rule_type === "glossary" && applied !== undefined) {
          const statistics = await compute_glossary_statistics(
            dependencies,
            applied.entries,
            execution_signal,
            dependencies.cache.items.readItems(),
            false,
          );
          for (const entry_id of applied.affected_entry_ids) {
            if ((statistics.matched_count_by_entry_id[entry_id] ?? 0) === 0) {
              const entry = applied.entries.find((candidate) => candidate["entry_id"] === entry_id);
              throw new Error(`术语 src 在语料中零出现：${String(entry?.["src"] ?? "")}`);
            }
          }
        }
        const write_result = await dependencies.qualityRules.update_from_agent(
          {
            rule_type: update.rule_type,
            ...(applied === undefined ? {} : { entries: applied.entries }),
            ...(update.meta === undefined ? {} : { meta: update.meta }),
            expected_section_revisions: update.expected_section_revisions,
          },
          AGENT_QUALITY_RULE_UPDATE_SOURCE,
        );
        const change = write_result.changes.at(-1);
        return tool_result({
          accepted: true,
          rule_type: update.rule_type,
          projectPath: change?.projectPath ?? current.projectPath,
          sectionRevisions: change?.sectionRevisions ?? current.sectionRevisions,
          affected_entries:
            applied?.entries.filter((entry) =>
              applied.affected_entry_ids.includes(String(entry["entry_id"] ?? "")),
            ) ?? [],
          deleted_entry_ids: applied?.deleted_entry_ids ?? [],
          meta: update.meta ?? current.meta,
        });
      },
    }),
  ];
}

/** 从权威规则切片生成 Agent 可消费的窄投影。 */
export async function query_agent_quality_rules(
  dependencies: AgentQualityDependencies,
  rule_type: QualityRuleKind,
  signal: AbortSignal = new AbortController().signal,
): Promise<JsonRecord & { entries: JsonRecord[] }> {
  const result = read_agent_quality_rules_snapshot(dependencies.qualityRules, rule_type);
  if (rule_type !== "glossary") return result;

  const glossary_entries = result.entries.map((entry) => normalize_glossary_entry(entry));
  const items = dependencies.cache.items.readItems();
  const statistics = await compute_glossary_statistics(
    dependencies,
    glossary_entries,
    signal,
    items,
    true,
  );
  result.entries = glossary_entries.map((entry) =>
    enrich_glossary_entry(
      entry,
      statistics.matched_count_by_entry_id[entry.entry_id] ?? 0,
      statistics.total_matches_by_entry_id[entry.entry_id] ?? 0,
      project_glossary_sample(items, statistics.context_sample_by_entry_id[entry.entry_id] ?? null),
    ),
  );
  result["structure"] = build_glossary_structure(
    glossary_entries,
    statistics.subset_parent_labels_by_entry_id,
  );
  return result;
}

/** 读取规则结构和 revision，不触发语料计算；query 与 update 共用同一规范化入口。 */
function read_agent_quality_rules_snapshot(
  quality_rules: AgentQualityRules,
  rule_type: QualityRuleKind,
): JsonRecord & { entries: JsonRecord[] } {
  const payload = quality_rules.query({ rule_type });
  const quality_rule = read_json_record(payload["qualityRule"]);
  const raw_entries = quality_rule["entries"] ?? [];
  const entries = ensure_quality_rule_entry_ids(
    normalize_quality_rule_entries(QualityRule.from_json(rule_type), raw_entries) as JsonRecord[],
  );
  const rule = QualityRule.from_json(rule_type);
  const result: JsonRecord & { entries: JsonRecord[] } = {
    rule_type,
    projectPath: String(payload["projectPath"] ?? ""),
    sectionRevisions: read_json_record(payload["sectionRevisions"]),
    meta:
      rule_type === "text_preserve"
        ? { mode: rule.normalize_mode(quality_rule["mode"]) }
        : { enabled: rule.normalize_enabled(quality_rule["enabled"]) },
    entries,
  };
  return result;
}

/** 在内存副本上完整应用规则变更；任一非法项不会触达持久化入口。 */
export function apply_agent_quality_rule_changes(args: {
  rule_type: QualityRuleKind;
  current_entries: JsonRecord[];
  changes: QualityRuleChange[];
}): { entries: JsonRecord[]; affected_entry_ids: string[]; deleted_entry_ids: string[] } {
  const entries = args.current_entries.map((entry) =>
    normalize_stored_entry(args.rule_type, entry),
  );
  assert_unique_entry_ids(entries);
  const targeted_entry_ids = new Set<string>();
  const placements: Array<{ entry_id: string; before_entry_id: string | null }> = [];
  const affected_entry_ids: string[] = [];
  const deleted_entry_ids: string[] = [];

  for (const change of args.changes) {
    if (change.action === "create") {
      const entry_id = create_quality_rule_entry_id();
      entries.push({
        ...normalize_writable_entry(args.rule_type, change.entry),
        entry_id,
      });
      affected_entry_ids.push(entry_id);
      if (Object.prototype.hasOwnProperty.call(change, "before_entry_id")) {
        placements.push({ entry_id, before_entry_id: change.before_entry_id ?? null });
      }
      continue;
    }

    const entry_id = normalize_entry_id(change.entry_id);
    if (targeted_entry_ids.has(entry_id)) {
      throw new Error(`同一质量规则条目不能重复变更：${entry_id}`);
    }
    targeted_entry_ids.add(entry_id);
    const index = entries.findIndex((entry) => entry["entry_id"] === entry_id);
    if (index < 0) throw new Error(`质量规则条目不存在：${entry_id}`);

    if (change.action === "delete") {
      entries.splice(index, 1);
      deleted_entry_ids.push(entry_id);
      continue;
    }
    entries[index] = {
      ...normalize_writable_entry(args.rule_type, change.entry),
      entry_id,
    };
    affected_entry_ids.push(entry_id);
    if (Object.prototype.hasOwnProperty.call(change, "before_entry_id")) {
      placements.push({ entry_id, before_entry_id: change.before_entry_id ?? null });
    }
  }

  for (const placement of placements) {
    move_entry_before(entries, placement.entry_id, placement.before_entry_id);
  }
  assert_unique_entry_ids(entries);
  return { entries, affected_entry_ids, deleted_entry_ids };
}

/** 读取投影按规则 kind 丢弃无关字段，同时保留稳定 entry_id。 */
function normalize_stored_entry(rule_type: QualityRuleKind, entry: JsonRecord): JsonRecord {
  return normalize_quality_rule_entries(QualityRule.from_json(rule_type), [entry])[0] as JsonRecord;
}

/** 写入条目统一裁剪文本、固定不可写字段并执行规则专属校验。 */
function normalize_writable_entry(rule_type: QualityRuleKind, entry: JsonRecord): JsonRecord {
  const normalized = normalize_quality_rule_entries(QualityRule.from_json(rule_type), [
    entry,
  ])[0] as JsonRecord | undefined;
  if (normalized === undefined) throw new Error("质量规则条目不能为空");
  if (rule_type === "glossary") {
    if (normalized["dst"] === "") throw new Error("术语 dst 去空白后不能为空");
  }
  return normalized;
}

/** 条目身份在比较和报错前统一裁剪，空值不进入变更流程。 */
function normalize_entry_id(value: unknown): string {
  const entry_id = String(value ?? "").trim();
  if (entry_id === "") throw new Error("质量规则变更缺少 entry_id");
  return entry_id;
}

/** 完整有序条目集合不能含重复身份。 */
function assert_unique_entry_ids(entries: JsonRecord[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    const entry_id = normalize_entry_id(entry["entry_id"]);
    if (ids.has(entry_id)) throw new Error(`质量规则 entry_id 重复：${entry_id}`);
    ids.add(entry_id);
  }
}

/** 在内存副本中把条目移动到锚点前；null 表示移到末尾。 */
function move_entry_before(
  entries: JsonRecord[],
  entry_id: string,
  before_entry_id: string | null,
): void {
  if (entry_id === before_entry_id) throw new Error("质量规则条目不能移动到自身之前");
  const source_index = entries.findIndex((entry) => entry["entry_id"] === entry_id);
  if (source_index < 0) throw new Error(`待移动质量规则条目不存在：${entry_id}`);
  const [entry] = entries.splice(source_index, 1);
  if (before_entry_id === null) {
    entries.push(entry);
    return;
  }
  const target_index = entries.findIndex((candidate) => candidate["entry_id"] === before_entry_id);
  if (target_index < 0) throw new Error(`质量规则移动锚点不存在：${before_entry_id}`);
  entries.splice(target_index, 0, entry);
}

type AgentGlossaryEntry = ResolvedGlossaryEntry &
  JsonRecord & {
    matched_item_count: number;
    total_matches: number;
    fact_violations: string[];
    sample: JsonRecord | null;
  };

/** 术语读取统一补齐事实分析字段的空初值。 */
function normalize_glossary_entry(entry: JsonRecord): AgentGlossaryEntry {
  return {
    entry_id: String(entry["entry_id"] ?? ""),
    src: String(entry["src"] ?? ""),
    dst: String(entry["dst"] ?? ""),
    info: String(entry["info"] ?? ""),
    case_sensitive: entry["case_sensitive"] === true,
    matched_item_count: 0,
    total_matches: 0,
    fact_violations: [],
    sample: null,
  };
}

/** 只附加机器可判事实，不替代模型的语义审校。 */
function enrich_glossary_entry(
  entry: AgentGlossaryEntry,
  matched_item_count: number,
  total_matches: number,
  sample: JsonRecord | null,
): AgentGlossaryEntry {
  const fact_violations: string[] = [];
  if (matched_item_count === 0) fact_violations.push("zero_occurrence");
  if (entry.dst === "") fact_violations.push("empty_dst");
  return { ...entry, matched_item_count, total_matches, fact_violations, sample };
}

type GlossaryContextSample = {
  item_index: number;
  matched_fields: Array<"src" | "name_src">;
};

/** worker 只返回数组索引，主线程用启动任务前捕获的同一 item 快照投影。 */
function project_glossary_sample(
  items: JsonRecord[],
  evidence: GlossaryContextSample | null,
): JsonRecord | null {
  if (evidence === null) return null;
  const item = items[evidence.item_index];
  if (item === undefined) return null;
  const item_id = read_json_integer(item["item_id"] ?? item["id"], 0);
  if (item_id <= 0) return null;
  return {
    item_id,
    matched_fields: evidence.matched_fields,
    src: String(item["src"] ?? ""),
    name_src: read_item_name_text(item["name_src"]) || null,
    file_path: String(item["file_path"] ?? ""),
    row_number: read_json_integer(item["row_number"] ?? item["row"], 0),
  };
}

/** 汇总重复、包含与共享前缀三类候选关系。 */
function build_glossary_structure(
  entries: AgentGlossaryEntry[],
  subset_parent_labels_by_entry_id: Record<string, string[]>,
): JsonRecord {
  const duplicate_groups = collect_quality_rule_duplicate_groups({
    rule_type: "GLOSSARY",
    entries,
  }).map(
    (group): JsonRecord => ({
      key: group.key,
      entry_ids: group.indexes.flatMap((index) => {
        const entry_id = entries[index]?.entry_id;
        return entry_id === undefined ? [] : [entry_id];
      }),
      srcs: group.indexes.flatMap((index) => {
        const src = entries[index]?.src;
        return src === undefined ? [] : [src];
      }),
    }),
  );
  const containment_candidates: JsonRecord[] = entries.flatMap((entry) => {
    const parents = subset_parent_labels_by_entry_id[entry.entry_id] ?? [];
    return parents.length === 0 ? [] : [{ entry_id: entry.entry_id, src: entry.src, parents }];
  });
  return {
    duplicate_src_groups: duplicate_groups,
    containment_candidates,
    root_candidates: build_shared_prefix_groups(entries.map((entry) => entry.src)),
  };
}

/** 在 compute worker 计算当前缓存文本的术语统计，并收窄跨线程返回值。 */
async function compute_glossary_statistics(
  dependencies: Pick<AgentQualityDependencies, "computeWorker">,
  entries: JsonRecord[],
  signal: AbortSignal,
  items: JsonRecord[],
  collect_literal_evidence: boolean,
): Promise<{
  matched_count_by_entry_id: Record<string, number>;
  subset_parent_labels_by_entry_id: Record<string, string[]>;
  total_matches_by_entry_id: Record<string, number>;
  context_sample_by_entry_id: Record<string, GlossaryContextSample | null>;
}> {
  const result = await dependencies.computeWorker.run(
    {
      type: "quality_statistics",
      input: prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries,
        items,
        collect_literal_evidence,
      }),
    },
    signal,
  );
  return {
    matched_count_by_entry_id: read_number_record(result["matched_count_by_entry_id"]),
    subset_parent_labels_by_entry_id: read_string_array_record(
      result["subset_parent_labels_by_entry_id"],
    ),
    total_matches_by_entry_id: read_number_record(result["total_matches_by_entry_id"]),
    context_sample_by_entry_id: read_context_sample_record(result["context_sample_by_entry_id"]),
  };
}

/** 跨线程计数映射只接受有限数字成员。 */
function read_number_record(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(read_json_record(value)).flatMap(([key, item]) =>
      typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
    ),
  );
}

/** 跨线程父级映射只保留字符串数组成员。 */
function read_string_array_record(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(read_json_record(value)).map(([key, item]) => [
      key,
      Array.isArray(item) ? item.filter((part): part is string => typeof part === "string") : [],
    ]),
  );
}

/** 跨线程 sample 只接受有效数组索引与稳定原文字段集合。 */
function read_context_sample_record(value: unknown): Record<string, GlossaryContextSample | null> {
  return Object.fromEntries(
    Object.entries(read_json_record(value)).map(([key, item]) => {
      if (item === null) return [key, null];
      const record = read_json_record(item);
      const item_index = record["item_index"];
      const fields = record["matched_fields"];
      if (
        !Number.isSafeInteger(item_index) ||
        (item_index as number) < 0 ||
        !Array.isArray(fields)
      ) {
        return [key, null];
      }
      const matched_fields = fields.filter(
        (field): field is "src" | "name_src" => field === "src" || field === "name_src",
      );
      return [key, { item_index: item_index as number, matched_fields }];
    }),
  );
}

/** 为至少两个术语共享且发生分叉的最长 Unicode 前缀分组。 */
function build_shared_prefix_groups(srcs: string[]): JsonRecord[] {
  // ponytail: 枚举全部 Unicode 前缀；词表规模让它不值得建 trie，profiling 证明变慢时再升级。
  const prefix_members = new Map<string, Set<string>>();
  for (const src of new Set(srcs)) {
    const characters = Array.from(src);
    for (let length = 2; length <= characters.length; length += 1) {
      const prefix = characters.slice(0, length).join("");
      const members = prefix_members.get(prefix) ?? new Set<string>();
      members.add(src);
      prefix_members.set(prefix, members);
    }
  }
  const longest_by_members = new Map<string, { prefix: string; members: string[] }>();
  for (const [prefix, member_set] of prefix_members) {
    const members = Array.from(member_set).sort();
    if (members.length < 2) continue;
    const next_characters = new Set(
      members.map((member) => Array.from(member).slice(Array.from(prefix).length)[0] ?? ""),
    );
    if (next_characters.size < 2) continue;
    const key = JsonTool.stringifyStrict(members);
    const current = longest_by_members.get(key);
    if (current === undefined || Array.from(prefix).length > Array.from(current.prefix).length) {
      longest_by_members.set(key, { prefix, members });
    }
  }
  return Array.from(longest_by_members.values())
    .sort((left, right) => left.prefix.localeCompare(right.prefix))
    .map(({ prefix, members }) => ({ root_candidate: prefix, members }));
}

/** 工具正文和 details 共用同一严格 JSON 事实。 */
function tool_result(details: JsonRecord) {
  return {
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  };
}
