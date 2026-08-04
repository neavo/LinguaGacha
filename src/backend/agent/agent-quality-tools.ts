import { Type, type TSchema } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { read_json_integer, read_json_record } from "../../domain/json";
import { QUALITY_RULE_KINDS, QualityRule, type QualityRuleKind } from "../../domain/quality";
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

const REPLACEMENT_RULE_TYPE_PARAMETERS = Type.Enum(
  ["pre_replacement", "post_replacement"] as const,
  { type: "string", description: "要更新的替换规则类型。" },
);

/** 术语、替换与文本保护分别公开精确字段，不把规则种类关联留给模型猜测。 */
const GLOSSARY_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    dst: Type.String(),
    info: Type.String(),
    case_sensitive: Type.Boolean(),
  },
  { additionalProperties: false },
);

const REPLACEMENT_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    dst: Type.String(),
    regex: Type.Boolean(),
    case_sensitive: Type.Boolean(),
  },
  { additionalProperties: false },
);

const TEXT_PRESERVE_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    info: Type.String(),
  },
  { additionalProperties: false },
);

/** 三类写工具共享意图明确的差异结构，避免模型把修改错误拆成新增与旧值回写。 */
function create_quality_rule_change_parameters<TEntry extends TSchema>(entry: TEntry) {
  return {
    create_entries: Type.Optional(
      Type.Array(
        Type.Object(
          {
            entry,
            insert_before_entry_id: Type.Optional(
              Type.String({
                minLength: 1,
                description: "把新条目插入该现有 entry_id 之前；省略表示追加到末尾。",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          description:
            "仅新增没有现有 entry_id 的独立条目；entry 必须是完整值。修改已有条目不得使用此字段。",
        },
      ),
    ),
    update_entries: Type.Optional(
      Type.Array(
        Type.Object(
          {
            entry_id: Type.String({
              minLength: 1,
              description: "当前快照中已有条目的稳定 ID；即使修改 src 也必须保留该 ID。",
            }),
            new_entry: entry,
            move_before_entry_id: Type.Optional(
              // null 分支必须在前，避免 SDK 的 TypeBox 转换把 null 改为空字符串。
              Type.Union([Type.Null(), Type.String({ minLength: 1 })], {
                description:
                  "同时移动到该现有 entry_id 之前；null 表示移到末尾，省略表示保持当前位置。",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          description:
            "修改已有条目；new_entry 是修改后的完整最终值，可改变 src、译文和其它可写字段。不得重复提交旧值。",
        },
      ),
    ),
    delete_entry_ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        uniqueItems: true,
        description: "删除已有条目时只提交当前快照中的 entry_id。",
      }),
    ),
  };
}

/** 质量写入只依赖 quality section revision。 */
const EXPECTED_QUALITY_REVISION_PARAMETERS = Type.Object(
  // number + multipleOf 避免 SDK 把小数先截断成 integer 再放行。
  {
    quality: Type.Number({
      minimum: 0,
      multipleOf: 1,
      description: "来自本次变更所依据 query_quality_rules 快照的 quality revision。",
    }),
  },
  { additionalProperties: false },
);

/** 查询入口只接收规则 kind。 */
const QUERY_QUALITY_RULES_PARAMETERS = Type.Object(
  { rule_type: RULE_TYPE_PARAMETERS },
  { additionalProperties: false },
);

const UPDATE_GLOSSARY_RULES_PARAMETERS = Type.Object(
  {
    ...create_quality_rule_change_parameters(GLOSSARY_ENTRY_PARAMETERS),
    expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
  },
  { additionalProperties: false },
);

const UPDATE_REPLACEMENT_RULES_PARAMETERS = Type.Object(
  {
    rule_type: REPLACEMENT_RULE_TYPE_PARAMETERS,
    ...create_quality_rule_change_parameters(REPLACEMENT_ENTRY_PARAMETERS),
    expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
  },
  { additionalProperties: false },
);

const UPDATE_TEXT_PRESERVE_RULES_PARAMETERS = Type.Object(
  {
    ...create_quality_rule_change_parameters(TEXT_PRESERVE_ENTRY_PARAMETERS),
    expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
  },
  { additionalProperties: false },
);

/** Schema 收窄后的分组差异保持模型原始意图，不再转换成第二套 action 词表。 */
type AgentQualityRuleChanges = {
  create_entries: Array<{ entry: JsonRecord; insert_before_entry_id?: string }>;
  update_entries: Array<{
    entry_id: string;
    new_entry: JsonRecord;
    move_before_entry_id?: string | null;
  }>;
  delete_entry_ids: string[];
};

type AgentQualityRuleUpdate = AgentQualityRuleChanges & {
  rule_type: QualityRuleKind;
  expected_section_revisions: { quality: number };
};

/** 三个精确写入 Schema 共享的差异载荷，不包含各规则独有设置。 */
type AgentQualityRuleChangeParameters = {
  create_entries?: Array<{ entry: unknown; insert_before_entry_id?: string }>;
  update_entries?: Array<{
    entry_id: string;
    new_entry: unknown;
    move_before_entry_id?: string | null;
  }>;
  delete_entry_ids?: string[];
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

/** 精确工具载荷只收窄条目对象，不改写已经明确的增删改意图。 */
function create_agent_quality_rule_update(
  rule_type: QualityRuleKind,
  params: AgentQualityRuleChangeParameters,
): AgentQualityRuleUpdate {
  const update: AgentQualityRuleUpdate = {
    rule_type,
    create_entries: (params.create_entries ?? []).map((change) => ({
      entry: read_json_record(change.entry),
      ...(Object.prototype.hasOwnProperty.call(change, "insert_before_entry_id")
        ? { insert_before_entry_id: change.insert_before_entry_id }
        : {}),
    })),
    update_entries: (params.update_entries ?? []).map((change) => ({
      entry_id: change.entry_id,
      new_entry: read_json_record(change.new_entry),
      ...(Object.prototype.hasOwnProperty.call(change, "move_before_entry_id")
        ? { move_before_entry_id: change.move_before_entry_id }
        : {}),
    })),
    delete_entry_ids: [...(params.delete_entry_ids ?? [])],
    expected_section_revisions: params.expected_section_revisions,
  };
  if (
    update.create_entries.length === 0 &&
    update.update_entries.length === 0 &&
    update.delete_entry_ids.length === 0
  ) {
    throw new Error("质量规则更新至少需要 create_entries、update_entries 或 delete_entry_ids");
  }
  return update;
}

/** 构造统一查询与三个精确写工具；领域持久化仍由 QualityRuleService 拥有。 */
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
      name: "update_glossary_rules",
      label: "更新术语规则",
      description:
        "原子应用术语条目的新增、修改、删除和重排。已有 entry_id 的术语必须使用 update_entries，只有独立新术语才使用 create_entries。",
      executionMode: "sequential",
      parameters: UPDATE_GLOSSARY_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        return execute_agent_quality_rule_update(
          dependencies,
          create_agent_quality_rule_update("glossary", params),
          signal,
        );
      },
    }),
    defineTool({
      name: "update_replacement_rules",
      label: "更新替换规则",
      description:
        "原子应用指定译前或译后替换条目的新增、修改、删除和重排。已有 entry_id 的规则必须使用 update_entries，只有独立新规则才使用 create_entries。",
      executionMode: "sequential",
      parameters: UPDATE_REPLACEMENT_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        return execute_agent_quality_rule_update(
          dependencies,
          create_agent_quality_rule_update(params.rule_type, params),
          signal,
        );
      },
    }),
    defineTool({
      name: "update_text_preserve_rules",
      label: "更新文本保护规则",
      description:
        "原子应用文本保护条目的新增、修改、删除和重排。已有 entry_id 的规则必须使用 update_entries，只有独立新规则才使用 create_entries。",
      executionMode: "sequential",
      parameters: UPDATE_TEXT_PRESERVE_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        return execute_agent_quality_rule_update(
          dependencies,
          create_agent_quality_rule_update("text_preserve", params),
          signal,
        );
      },
    }),
  ];
}

/** 三个模型写入口共用同一质量规则事务、统计与确认语义。 */
async function execute_agent_quality_rule_update(
  dependencies: AgentQualityDependencies,
  update: AgentQualityRuleUpdate,
  signal: AbortSignal | undefined,
) {
  signal?.throwIfAborted();
  const execution_signal = signal ?? new AbortController().signal;
  // 更新只读取规则结构；术语语料统计统一留给 prospective 集合，避免同一写入扫描两次。
  const current = read_agent_quality_rules_snapshot(dependencies.qualityRules, update.rule_type);
  const applied = apply_agent_quality_rule_changes({
    rule_type: update.rule_type,
    current_entries: current.entries,
    create_entries: update.create_entries,
    update_entries: update.update_entries,
    delete_entry_ids: update.delete_entry_ids,
  });
  if (update.rule_type === "glossary") {
    const statistics = await compute_glossary_statistics(
      dependencies,
      applied.entries,
      execution_signal,
      dependencies.cache.items.readItems(),
      false,
    );
    for (const entry_id of [...applied.created_entry_ids, ...applied.updated_entry_ids]) {
      if ((statistics.matched_count_by_entry_id[entry_id] ?? 0) === 0) {
        const entry = applied.entries.find((candidate) => candidate["entry_id"] === entry_id);
        throw new Error(`术语 src 在语料中零出现：${String(entry?.["src"] ?? "")}`);
      }
    }
  }
  const write_result = await dependencies.qualityRules.update_from_agent(
    {
      rule_type: update.rule_type,
      entries: applied.entries,
      expected_section_revisions: update.expected_section_revisions,
    },
    AGENT_QUALITY_RULE_UPDATE_SOURCE,
  );
  const change = write_result.changes.at(-1);
  return tool_result({
    accepted: true,
    rule_type: update.rule_type,
    sectionRevisions: change?.sectionRevisions ?? current.sectionRevisions,
    created_entries: applied.entries.filter((entry) =>
      applied.created_entry_ids.includes(String(entry["entry_id"] ?? "")),
    ),
    updated_entries: applied.entries.filter((entry) =>
      applied.updated_entry_ids.includes(String(entry["entry_id"] ?? "")),
    ),
    deleted_entry_ids: applied.deleted_entry_ids,
  });
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
function apply_agent_quality_rule_changes(
  args: AgentQualityRuleChanges & {
    rule_type: QualityRuleKind;
    current_entries: JsonRecord[];
  },
): {
  entries: JsonRecord[];
  created_entry_ids: string[];
  updated_entry_ids: string[];
  deleted_entry_ids: string[];
} {
  const entries = args.current_entries.map((entry) =>
    normalize_stored_entry(args.rule_type, entry),
  );
  assert_unique_entry_ids(entries);
  const targeted_entry_ids = new Set<string>();
  const placements: Array<{ entry_id: string; before_entry_id: string | null }> = [];
  const created_entry_ids: string[] = [];
  const updated_entry_ids: string[] = [];
  const deleted_entry_ids: string[] = [];
  // 修改与删除共享同一目标存在性和单批唯一性约束，局部闭包不扩张模块表面。
  const find_target = (value: unknown): { entry_id: string; index: number } => {
    const entry_id = normalize_entry_id(value);
    if (targeted_entry_ids.has(entry_id)) {
      throw new Error(`同一质量规则条目不能重复变更：${entry_id}`);
    }
    targeted_entry_ids.add(entry_id);
    const index = entries.findIndex((entry) => entry["entry_id"] === entry_id);
    if (index < 0) throw new Error(`质量规则条目不存在：${entry_id}`);
    return { entry_id, index };
  };

  for (const change of args.create_entries) {
    const entry_id = create_quality_rule_entry_id();
    entries.push({
      ...normalize_writable_entry(args.rule_type, change.entry),
      entry_id,
    });
    created_entry_ids.push(entry_id);
    if (Object.prototype.hasOwnProperty.call(change, "insert_before_entry_id")) {
      placements.push({ entry_id, before_entry_id: change.insert_before_entry_id ?? null });
    }
  }

  for (const change of args.update_entries) {
    const { entry_id, index } = find_target(change.entry_id);
    entries[index] = {
      ...normalize_writable_entry(args.rule_type, change.new_entry),
      entry_id,
    };
    updated_entry_ids.push(entry_id);
    if (Object.prototype.hasOwnProperty.call(change, "move_before_entry_id")) {
      placements.push({ entry_id, before_entry_id: change.move_before_entry_id ?? null });
    }
  }

  for (const deleted_entry_id of args.delete_entry_ids) {
    const { entry_id, index } = find_target(deleted_entry_id);
    entries.splice(index, 1);
    deleted_entry_ids.push(entry_id);
  }

  for (const placement of placements) {
    move_entry_before(entries, placement.entry_id, placement.before_entry_id);
  }
  assert_unique_entry_ids(entries);
  return { entries, created_entry_ids, updated_entry_ids, deleted_entry_ids };
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
  }).map((group): JsonRecord => ({
    key: group.key,
    entry_ids: group.indexes.flatMap((index) => {
      const entry_id = entries[index]?.entry_id;
      return entry_id === undefined ? [] : [entry_id];
    }),
    srcs: group.indexes.flatMap((index) => {
      const src = entries[index]?.src;
      return src === undefined ? [] : [src];
    }),
  }));
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
