import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { read_json_integer, read_json_record } from "../../domain/json";
import { QUALITY_RULE_KINDS, QualityRule, type QualityRuleKind } from "../../domain/quality";
import { InternalInvariantError, is_app_error } from "../../shared/error";
import {
  collect_quality_rule_duplicate_groups,
  QualityRuleImportRuleTypeValue,
  type QualityRuleImportRuleType,
} from "../../shared/quality/quality-rule-import";
import { create_quality_rule_entry_id } from "../../shared/quality/quality-rule-entry-id";
import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { ResolvedGlossaryEntry } from "../../shared/quality/glossary";
import { read_item_name_text } from "../../shared/item-name";
import { AgentToolError, agent_tool_result } from "./agent-tool";

/** 质量规则工具只公开四个稳定业务 kind，不接受数据库物理类型。 */
const RULE_TYPE_PARAMETERS = Type.Enum(QUALITY_RULE_KINDS, {
  type: "string",
  description: "决定 entry 的有效业务字段。",
});

/** 复用导入域的重复键口径，避免 Agent 写入口产生第二套规则种类映射。 */
const DUPLICATE_RULE_TYPE_BY_KIND = Object.freeze({
  glossary: QualityRuleImportRuleTypeValue.GLOSSARY,
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
  text_preserve: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
} satisfies Record<QualityRuleKind, QualityRuleImportRuleType>);

/** 普通对象 Schema 保持跨供应商稳定，规则种类关联由 Agent 入口收窄。 */
const QUALITY_RULE_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    dst: Type.Optional(Type.String()),
    info: Type.Optional(Type.String()),
    regex: Type.Optional(Type.Boolean()),
    case_sensitive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/** write 以 entry_id 区分更新和创建，before_entry_id 只表达新条目位置。 */
const QUALITY_RULE_WRITE_PARAMETERS = Type.Object(
  {
    entry_id: Type.Optional(
      Type.String({
        minLength: 1,
        description: "已有条目必须携带当前快照中的稳定 ID；省略表示创建独立新条目。",
      }),
    ),
    entry: QUALITY_RULE_ENTRY_PARAMETERS,
    before_entry_id: Type.Optional(
      Type.String({
        minLength: 1,
        description: "仅创建时可用；把新条目插入该现有 entry_id 之前。省略表示追加。",
      }),
    ),
  },
  { additionalProperties: false },
);

/** 已有条目排序与内容写入分离，允许一次提交同时更新并移动同一条目。 */
const QUALITY_RULE_MOVE_PARAMETERS = Type.Object(
  {
    entry_id: Type.String({ minLength: 1 }),
    // null 分支必须在前，避免 SDK 的 TypeBox 转换把 null 改为空字符串。
    before_entry_id: Type.Union([Type.Null(), Type.String({ minLength: 1 })], {
      description: "移动到该现有 entry_id 之前；null 表示移到末尾。",
    }),
  },
  { additionalProperties: false },
);

/** Agent 质量工具只依赖单一 quality revision，不暴露底层 section 包装。 */
const EXPECTED_QUALITY_REVISION_PARAMETERS = Type.Number({
  minimum: 0,
  multipleOf: 1,
  description: "来自本次变更所依据 query_quality_rules 快照的 revision。",
});

/** srcs 是精确字面量选择，不引入分页或第二套搜索语义。 */
const QUERY_QUALITY_RULES_PARAMETERS = Type.Object(
  {
    rule_type: RULE_TYPE_PARAMETERS,
    filters: Type.Optional(
      Type.Object(
        {
          srcs: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** 单一普通对象 Schema 避免供应商对判别联合类型的不一致支持。 */
const UPDATE_QUALITY_RULES_PARAMETERS = Type.Object(
  {
    rule_type: RULE_TYPE_PARAMETERS,
    write: Type.Optional(
      Type.Array(QUALITY_RULE_WRITE_PARAMETERS, {
        minItems: 1,
        description:
          "有 entry_id 时更新已有条目，无 entry_id 时创建新条目。entry 始终是完整最终值。",
      }),
    ),
    delete: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    ),
    move: Type.Optional(Type.Array(QUALITY_RULE_MOVE_PARAMETERS, { minItems: 1 })),
    expected_revision: EXPECTED_QUALITY_REVISION_PARAMETERS,
  },
  { additionalProperties: false },
);

/** write_index 保留模型原始数组位置，使新 ID 回执和错误路径无需复制条目正文。 */
type AgentQualityRuleChanges = {
  write: Array<{
    write_index: number;
    entry_id?: string;
    entry: JsonRecord;
    before_entry_id?: string;
  }>;
  delete: string[];
  move: Array<{ entry_id: string; before_entry_id: string | null }>;
};

/** Schema 载荷完成领域收窄后的原子更新输入。 */
type AgentQualityRuleUpdate = AgentQualityRuleChanges & {
  rule_type: QualityRuleKind;
  expected_revision: number;
};

/** SDK Schema 已验证、但尚未按 rule_type 校验 entry 字段的模型载荷。 */
type AgentQualityRuleParameters = {
  rule_type: QualityRuleKind;
  write?: Array<{ entry_id?: string; entry: unknown; before_entry_id?: string }>;
  delete?: string[];
  move?: Array<{ entry_id: string; before_entry_id: string | null }>;
  expected_revision: number;
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

/** 一个普通对象入口按 rule_type 收窄业务字段，并以 entry_id 决定创建或更新。 */
function read_agent_quality_rule_update(
  params: AgentQualityRuleParameters,
): AgentQualityRuleUpdate {
  const rule_type = QualityRule.from_json(params.rule_type).kind;
  const update: AgentQualityRuleUpdate = {
    rule_type,
    write: (params.write ?? []).map((change, write_index) => {
      if (change.entry_id !== undefined && change.before_entry_id !== undefined) {
        throw new AgentToolError({
          code: "quality_rule.invalid_write",
          path: `write[${write_index.toString()}].before_entry_id`,
          action: "move",
        });
      }
      return {
        write_index,
        ...(change.entry_id === undefined ? {} : { entry_id: change.entry_id }),
        entry: read_agent_quality_rule_entry(
          rule_type,
          change.entry,
          `write[${write_index.toString()}].entry`,
        ),
        ...(change.before_entry_id === undefined
          ? {}
          : { before_entry_id: change.before_entry_id }),
      };
    }),
    delete: [...(params.delete ?? [])],
    move: [...(params.move ?? [])],
    expected_revision: params.expected_revision,
  };
  if (update.write.length === 0 && update.delete.length === 0 && update.move.length === 0) {
    throw new AgentToolError({ code: "quality_rule.empty_change" });
  }
  return update;
}

/** rule_type 决定模型写入条目必须且只能具有的完整字段集合。 */
function read_agent_quality_rule_entry(
  rule_type: QualityRuleKind,
  value: unknown,
  path: string,
): JsonRecord {
  const entry = read_json_record(value);
  const fields =
    rule_type === "glossary"
      ? ["src", "dst", "info", "case_sensitive"]
      : rule_type === "text_preserve"
        ? ["src", "info"]
        : ["src", "dst", "regex", "case_sensitive"];
  assert_fields(entry, fields, path);
  return entry;
}

/** 运行时按 rule_type 补足普通 Schema 无法表达的必填与排他字段约束。 */
function assert_fields(record: JsonRecord, required: readonly string[], path: string): void {
  const allowed = new Set(required);
  const unknown = Object.keys(record).find((field) => !allowed.has(field));
  if (unknown !== undefined) {
    throw new AgentToolError({
      code: "quality_rule.invalid_entry_field",
      path: `${path}.${unknown}`,
    });
  }
  const missing = required.find((field) => !Object.prototype.hasOwnProperty.call(record, field));
  if (missing !== undefined) {
    throw new AgentToolError({
      code: "quality_rule.missing_entry_field",
      path: `${path}.${missing}`,
    });
  }
}

/** 构造统一质量规则查询与原子写工具；领域持久化仍由 QualityRuleService 拥有。 */
export function create_agent_quality_tools(
  dependencies: AgentQualityDependencies,
): ToolDefinition[] {
  return [
    defineTool({
      name: "query_quality_rules",
      label: "查询质量规则",
      description:
        "查询当前工程指定质量规则的有序条目和 revision；filters.srcs 按规则原文精确筛选。glossary 另返回 item_revision、覆盖数、最多两个代表语境和包含父项。",
      parameters: QUERY_QUALITY_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        return agent_tool_result(
          await query_agent_quality_rules(
            dependencies,
            params.rule_type,
            signal ?? new AbortController().signal,
            params.filters?.srcs,
          ),
        );
      },
    }),
    defineTool({
      name: "update_quality_rules",
      label: "更新质量规则",
      description:
        "按 rule_type 原子应用 write、delete 和 move。write 有 entry_id 时更新已有条目，无 entry_id 时创建新条目；任一业务校验失败均不写入。",
      executionMode: "sequential",
      parameters: UPDATE_QUALITY_RULES_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        return execute_agent_quality_rule_update(
          dependencies,
          read_agent_quality_rule_update(params),
          signal,
        );
      },
    }),
  ];
}

/** 统一模型写入口先验证 prospective 集合，再复用质量规则事务与确认语义。 */
async function execute_agent_quality_rule_update(
  dependencies: AgentQualityDependencies,
  update: AgentQualityRuleUpdate,
  signal: AbortSignal | undefined,
) {
  signal?.throwIfAborted();
  const current = read_agent_quality_rules_snapshot(dependencies.qualityRules, update.rule_type);
  const applied = apply_agent_quality_rule_changes({
    rule_type: update.rule_type,
    current_entries: current.entries,
    write: update.write,
    delete: update.delete,
    move: update.move,
  });
  const current_revision = read_json_integer(current["revision"], 0);
  if (
    applied.created.length === 0 &&
    applied.updated.length === 0 &&
    applied.deleted.length === 0 &&
    applied.moved.length === 0
  ) {
    return agent_tool_result({ status: "unchanged", revision: current_revision });
  }
  const write_result = await dependencies.qualityRules
    .update_from_agent(
      {
        rule_type: update.rule_type,
        entries: applied.entries,
        expected_section_revisions: { quality: update.expected_revision },
      },
      AGENT_QUALITY_RULE_UPDATE_SOURCE,
    )
    .catch((cause: unknown) => {
      if (is_app_error(cause) && cause.code === "data.revision_conflict") {
        throw new AgentToolError(
          { code: cause.code, ...cause.public_details, action: "query_quality_rules" },
          cause,
        );
      }
      throw cause;
    });
  const change = write_result.changes.at(-1);
  if (change === undefined) {
    throw new AgentToolError({
      code: "quality_rule.write_not_confirmed",
      action: "query_quality_rules",
    });
  }
  return agent_tool_result({
    status: "applied",
    revision: read_json_integer(change.sectionRevisions["quality"], current_revision),
    ...(applied.created.length === 0 ? {} : { created: applied.created }),
    ...(applied.updated.length === 0 ? {} : { updated: applied.updated }),
    ...(applied.deleted.length === 0 ? {} : { deleted: applied.deleted }),
    ...(applied.moved.length === 0 ? {} : { moved: applied.moved }),
  });
}

/** 从权威规则切片生成 Agent 可消费的窄投影。 */
export async function query_agent_quality_rules(
  dependencies: AgentQualityDependencies,
  rule_type: QualityRuleKind,
  signal: AbortSignal = new AbortController().signal,
  srcs?: readonly string[],
): Promise<JsonRecord & { entries: JsonRecord[] }> {
  // readItems 可能先恢复 cache；随后读取 revision 才能与本次统计使用的 item 快照一致。
  const items = rule_type === "glossary" ? dependencies.cache.items.readItems() : [];
  const result = read_agent_quality_rules_snapshot(
    dependencies.qualityRules,
    rule_type,
    rule_type === "glossary",
  );
  const all_entries = result.entries;
  if (srcs !== undefined) {
    const selected_srcs = new Set(srcs);
    result.entries = all_entries.filter((entry) => selected_srcs.has(String(entry["src"] ?? "")));
  }
  if (rule_type !== "glossary") return result;

  const glossary_entries = result.entries.map((entry) => normalize_glossary_entry(entry));
  const relation_entries = all_entries.map((entry) => normalize_glossary_entry(entry));
  const statistics = await compute_glossary_statistics(
    dependencies,
    glossary_entries,
    signal,
    items,
    relation_entries,
  );
  result.entries = glossary_entries.map((entry) =>
    enrich_glossary_entry(
      entry,
      statistics.matched_count_by_entry_id[entry.entry_id] ?? 0,
      project_glossary_samples(items, statistics.context_samples_by_entry_id[entry.entry_id] ?? []),
      statistics.subset_parent_labels_by_entry_id[entry.entry_id] ?? [],
    ),
  );
  return result;
}

/** 读取规则结构和 revision，不触发语料计算；query 与 update 共用同一规范化入口。 */
function read_agent_quality_rules_snapshot(
  quality_rules: AgentQualityRules,
  rule_type: QualityRuleKind,
  include_item_revision = false,
): JsonRecord & { entries: JsonRecord[] } {
  const payload = quality_rules.query({ rule_type });
  const section_revisions = read_json_record(payload["sectionRevisions"]);
  const quality_rule = read_json_record(payload["qualityRule"]);
  const raw_entries = quality_rule["entries"] ?? [];
  assert_stored_entry_ids(raw_entries);
  const entries = normalize_quality_rule_entries(
    QualityRule.from_json(rule_type),
    raw_entries,
  ) as JsonRecord[];
  assert_unique_entry_ids(entries);
  const result: JsonRecord & { entries: JsonRecord[] } = {
    rule_type,
    revision: read_json_integer(section_revisions["quality"], 0),
    ...(include_item_revision
      ? { item_revision: read_json_integer(section_revisions["items"], 0) }
      : {}),
    entries,
  };
  return result;
}

/** 在共享 normalizer 处理领域字段前先验证当前存储身份，避免损坏事实伪装成业务输入错误。 */
function assert_stored_entry_ids(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "quality_rule_stored_entries_invalid" },
    });
  }
  const ids = new Set<string>();
  for (const value_entry of value) {
    const entry_id = String(read_json_record(value_entry)["entry_id"] ?? "").trim();
    if (entry_id === "") {
      throw new InternalInvariantError({
        diagnostic_context: { reason: "quality_rule_stored_entry_id_missing" },
      });
    }
    if (ids.has(entry_id)) {
      throw new InternalInvariantError({
        diagnostic_context: { reason: "quality_rule_duplicate_entry_id", entry_id },
      });
    }
    ids.add(entry_id);
  }
}

/** 在内存副本上完整应用规则变更；任一非法项不会触达持久化入口。 */
function apply_agent_quality_rule_changes(
  args: AgentQualityRuleChanges & {
    rule_type: QualityRuleKind;
    current_entries: JsonRecord[];
  },
): {
  entries: JsonRecord[];
  created: Array<{ write_index: number; entry_id: string }>;
  updated: string[];
  deleted: string[];
  moved: string[];
} {
  const entries = args.current_entries.map((entry) =>
    normalize_stored_entry(args.rule_type, entry),
  );
  const previous_entries = entries.map((entry) => ({ ...entry }));
  assert_unique_entry_ids(entries);
  // 内容写入与删除互斥；移动可与内容更新组合，但不能与删除或另一移动重复。
  const exclusive_target_paths = new Map<string, string>();
  const deleted_paths = new Map<string, string>();
  const moved_paths = new Map<string, string>();
  // 只记录真正改变重复键的写入来源，用于返回模型可直接修正的路径。
  const origins = new Map<string, { path: string; created: boolean }>();
  const placements: Array<{
    entry_id: string;
    before_entry_id: string | null;
    path: string;
    report_move: boolean;
  }> = [];
  const created: Array<{ write_index: number; entry_id: string }> = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const moved: string[] = [];
  /** 内容写入与删除共用目标锁，并在修改前确认条目仍存在。 */
  const find_exclusive_target = (
    value: unknown,
    path: string,
  ): { entry_id: string; index: number } => {
    const entry_id = normalize_entry_id(value);
    const previous_path = exclusive_target_paths.get(entry_id);
    if (previous_path !== undefined) {
      throw new AgentToolError({
        code: "quality_rule.target_conflict",
        entry_id,
        paths: [previous_path, path],
      });
    }
    exclusive_target_paths.set(entry_id, path);
    const index = entries.findIndex((entry) => entry["entry_id"] === entry_id);
    if (index < 0) {
      throw new AgentToolError({ code: "quality_rule.entry_not_found", entry_id, path });
    }
    return { entry_id, index };
  };

  for (const write of args.write) {
    const path = `write[${write.write_index.toString()}]`;
    const normalized = normalize_writable_entry(args.rule_type, write.entry, `${path}.entry`);
    if (write.entry_id === undefined) {
      const entry_id = create_quality_rule_entry_id();
      entries.push({ entry_id, ...normalized });
      created.push({ write_index: write.write_index, entry_id });
      origins.set(entry_id, { path, created: true });
      if (write.before_entry_id !== undefined) {
        placements.push({
          entry_id,
          before_entry_id: write.before_entry_id,
          path: `${path}.before_entry_id`,
          report_move: false,
        });
      }
      continue;
    }
    const { entry_id, index } = find_exclusive_target(write.entry_id, `${path}.entry_id`);
    const next_entry = { entry_id, ...normalized };
    if (JSON.stringify(entries[index]) !== JSON.stringify(next_entry)) {
      entries[index] = next_entry;
      updated.push(entry_id);
      origins.set(entry_id, { path, created: false });
    }
  }

  for (const [delete_index, deleted_entry_id] of args.delete.entries()) {
    const path = `delete[${delete_index.toString()}]`;
    const { entry_id, index } = find_exclusive_target(deleted_entry_id, path);
    entries.splice(index, 1);
    deleted.push(entry_id);
    deleted_paths.set(entry_id, path);
  }

  for (const [move_index, move] of args.move.entries()) {
    const path = `move[${move_index.toString()}]`;
    const entry_id = normalize_entry_id(move.entry_id);
    const delete_path = deleted_paths.get(entry_id);
    if (delete_path !== undefined) {
      throw new AgentToolError({
        code: "quality_rule.target_conflict",
        entry_id,
        paths: [delete_path, `${path}.entry_id`],
      });
    }
    const previous_path = moved_paths.get(entry_id);
    if (previous_path !== undefined) {
      throw new AgentToolError({
        code: "quality_rule.target_conflict",
        entry_id,
        paths: [previous_path, `${path}.entry_id`],
      });
    }
    moved_paths.set(entry_id, `${path}.entry_id`);
    if (!entries.some((entry) => entry["entry_id"] === entry_id)) {
      throw new AgentToolError({
        code: "quality_rule.entry_not_found",
        entry_id,
        path: `${path}.entry_id`,
      });
    }
    placements.push({
      entry_id,
      before_entry_id: move.before_entry_id,
      path: `${path}.before_entry_id`,
      report_move: true,
    });
  }

  for (const placement of placements) {
    if (
      move_entry_before(entries, placement.entry_id, placement.before_entry_id, placement.path) &&
      placement.report_move
    ) {
      moved.push(placement.entry_id);
    }
  }
  assert_unique_entry_ids(entries);
  assert_no_new_duplicate_groups(args.rule_type, previous_entries, entries, origins);
  return { entries, created, updated, deleted, moved };
}

/** 读取投影按规则 kind 丢弃无关字段，同时保留稳定 entry_id。 */
function normalize_stored_entry(rule_type: QualityRuleKind, entry: JsonRecord): JsonRecord {
  const normalized = normalize_quality_rule_entries(QualityRule.from_json(rule_type), [
    entry,
  ])[0] as JsonRecord | undefined;
  const entry_id = String(normalized?.["entry_id"] ?? "").trim();
  if (normalized === undefined || entry_id === "") {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "quality_rule_stored_entry_id_missing" },
    });
  }
  return { ...normalized, entry_id };
}

/** 写入条目统一裁剪文本、固定不可写字段并执行规则专属校验。 */
function normalize_writable_entry(
  rule_type: QualityRuleKind,
  entry: JsonRecord,
  path: string,
): JsonRecord {
  if (String(entry["src"]).trim() === "") {
    throw new AgentToolError({ code: "quality_rule.empty_entry", path });
  }
  if (rule_type === "glossary" && String(entry["dst"]).trim() === "") {
    throw new AgentToolError({ code: "quality_rule.empty_entry_field", path: `${path}.dst` });
  }
  const normalized = normalize_quality_rule_entries(QualityRule.from_json(rule_type), [
    entry,
  ])[0] as JsonRecord | undefined;
  if (normalized === undefined) {
    throw new AgentToolError({ code: "quality_rule.empty_entry", path });
  }
  return normalized;
}

/** Agent 可以清理历史重复，但一次写入不得新增或扩大按领域 key 判定的重复组。 */
function assert_no_new_duplicate_groups(
  rule_type: QualityRuleKind,
  previous_entries: JsonRecord[],
  next_entries: JsonRecord[],
  origins: Map<string, { path: string; created: boolean }>,
): void {
  const duplicate_rule_type = DUPLICATE_RULE_TYPE_BY_KIND[rule_type];
  const previous_counts = new Map(
    collect_quality_rule_duplicate_groups({
      rule_type: duplicate_rule_type,
      entries: previous_entries,
    }).map((group) => [group.key, group.indexes.length]),
  );
  const conflict = collect_quality_rule_duplicate_groups({
    rule_type: duplicate_rule_type,
    entries: next_entries,
  }).find((group) => group.indexes.length > (previous_counts.get(group.key) ?? 1));
  if (conflict === undefined) return;

  const all_entry_ids = conflict.indexes.map((index) =>
    normalize_entry_id(next_entries[index]?.["entry_id"]),
  );
  const conflict_origins = all_entry_ids.flatMap((entry_id) => {
    const origin = origins.get(entry_id);
    return origin === undefined ? [] : [origin];
  });
  const entry_ids = all_entry_ids.filter((entry_id) => !origins.get(entry_id)?.created);
  const paths = [...new Set(conflict_origins.map((origin) => origin.path))];
  const created_paths = conflict_origins
    .filter((origin) => origin.created)
    .map((origin) => origin.path);
  throw new AgentToolError({
    code: "quality_rule.duplicate_final_entry",
    paths,
    ...(entry_ids.length === 0 ? {} : { entry_ids }),
    ...(created_paths.length === 1 ? { remove: created_paths[0] } : {}),
  });
}

/** 条目身份在比较和报错前统一裁剪，空值不进入变更流程。 */
function normalize_entry_id(value: unknown): string {
  const entry_id = String(value ?? "").trim();
  if (entry_id === "") {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "quality_rule_entry_id_missing" },
    });
  }
  return entry_id;
}

/** 完整有序条目集合不能含重复身份。 */
function assert_unique_entry_ids(entries: JsonRecord[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    const entry_id = normalize_entry_id(entry["entry_id"]);
    if (ids.has(entry_id)) {
      throw new InternalInvariantError({
        diagnostic_context: { reason: "quality_rule_duplicate_entry_id", entry_id },
      });
    }
    ids.add(entry_id);
  }
}

/** 在内存副本中把条目移动到锚点前；null 表示移到末尾。 */
function move_entry_before(
  entries: JsonRecord[],
  entry_id: string,
  before_entry_id: string | null,
  path: string,
): boolean {
  if (entry_id === before_entry_id) {
    throw new AgentToolError({ code: "quality_rule.invalid_move", entry_id, path });
  }
  const source_index = entries.findIndex((entry) => entry["entry_id"] === entry_id);
  if (source_index < 0) {
    throw new AgentToolError({ code: "quality_rule.entry_not_found", entry_id, path });
  }
  const [entry] = entries.splice(source_index, 1);
  if (entry === undefined) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "quality_rule_move_source_missing", entry_id },
    });
  }
  if (before_entry_id === null) {
    entries.push(entry);
    return source_index !== entries.length - 1;
  }
  const target_index = entries.findIndex((candidate) => candidate["entry_id"] === before_entry_id);
  if (target_index < 0) {
    throw new AgentToolError({
      code: "quality_rule.entry_not_found",
      entry_id: before_entry_id,
      path,
    });
  }
  entries.splice(target_index, 0, entry);
  return source_index !== target_index;
}

/** 模型可见的术语条目只保留审校所需字段与当前快照事实。 */
type AgentGlossaryEntry = ResolvedGlossaryEntry &
  JsonRecord & {
    matched_item_count: number;
    samples: JsonRecord[];
    parent_srcs?: string[];
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
    samples: [],
  };
}

/** 附加覆盖、代表语境和完整术语包含关系，不返回可从字段直接推导的信号。 */
function enrich_glossary_entry(
  entry: AgentGlossaryEntry,
  matched_item_count: number,
  samples: JsonRecord[],
  parent_srcs: string[],
): AgentGlossaryEntry {
  return {
    ...entry,
    matched_item_count,
    samples,
    ...(parent_srcs.length === 0 ? {} : { parent_srcs }),
  };
}

/** compute worker 返回的索引只允许投影同一次捕获的 item 快照。 */
type GlossaryContextSample = {
  item_index: number; // captured items 中的稳定数组索引
};

/** worker 只返回数组索引，主线程用启动任务前捕获的同一 item 快照投影最小语境。 */
function project_glossary_samples(
  items: JsonRecord[],
  evidence: GlossaryContextSample[],
): JsonRecord[] {
  return evidence.flatMap(({ item_index }) => {
    const item = items[item_index];
    if (item === undefined) return [];
    const item_id = read_json_integer(item["item_id"] ?? item["id"], 0);
    if (item_id <= 0) return [];
    const name_src = read_item_name_text(item["name_src"]);
    return [
      {
        item_id,
        src: String(item["src"] ?? ""),
        ...(name_src === "" ? {} : { name_src }),
      },
    ];
  });
}

/** 在 compute worker 计算当前缓存文本的术语统计，并收窄跨线程返回值。 */
async function compute_glossary_statistics(
  dependencies: Pick<AgentQualityDependencies, "computeWorker">,
  entries: JsonRecord[],
  signal: AbortSignal,
  items: JsonRecord[],
  relation_entries: JsonRecord[],
): Promise<{
  matched_count_by_entry_id: Record<string, number>;
  subset_parent_labels_by_entry_id: Record<string, string[]>;
  context_samples_by_entry_id: Record<string, GlossaryContextSample[]>;
}> {
  const result = await dependencies.computeWorker.run(
    {
      type: "quality_statistics",
      input: prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries,
        relation_entries,
        items,
        collect_context_samples: true,
      }),
    },
    signal,
  );
  return {
    matched_count_by_entry_id: read_number_record(result["matched_count_by_entry_id"]),
    subset_parent_labels_by_entry_id: read_string_array_record(
      result["subset_parent_labels_by_entry_id"],
    ),
    context_samples_by_entry_id: read_context_samples_record(result["context_samples_by_entry_id"]),
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

/** 跨线程 samples 只接受最多两个有效数组索引。 */
function read_context_samples_record(value: unknown): Record<string, GlossaryContextSample[]> {
  return Object.fromEntries(
    Object.entries(read_json_record(value)).map(([key, item]) => {
      if (!Array.isArray(item)) return [key, []];
      return [
        key,
        item.slice(0, 2).flatMap((sample) => {
          const item_index = read_json_record(sample)["item_index"];
          return Number.isSafeInteger(item_index) && (item_index as number) >= 0
            ? [{ item_index: item_index as number }]
            : [];
        }),
      ];
    }),
  );
}
