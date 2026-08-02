import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { is_json_record, read_json_record } from "../../domain/json";
import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import { collect_quality_rule_duplicate_groups } from "../../shared/quality/quality-rule-import";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "../../shared/quality/quality-rule-entry-id";
import { type QualityStatisticsRuleMode } from "../../shared/quality/quality-statistics";
import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { compile_text_pattern } from "../../shared/text/text-pattern";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleService } from "../quality/quality-rule-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";

/** 质量规则工具只公开四个稳定业务 kind，不接受数据库物理类型。 */
const RULE_TYPE_PARAMETERS = Type.Union([
  Type.Literal("glossary"),
  Type.Literal("pre_replacement"),
  Type.Literal("post_replacement"),
  Type.Literal("text_preserve"),
]);

/** 术语条目要求完整语义字段，regex 固定由后端关闭。 */
const GLOSSARY_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    dst: Type.String(),
    info: Type.String(),
    case_sensitive: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** 前后替换共享同一可写条目形状。 */
const REPLACEMENT_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    dst: Type.String(),
    regex: Type.Boolean(),
    case_sensitive: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** 文本保护只接受模式源与说明，存储默认字段由后端补齐。 */
const TEXT_PRESERVE_ENTRY_PARAMETERS = Type.Object(
  {
    src: Type.String(),
    info: Type.String(),
  },
  { additionalProperties: false },
);

/** 增删改协议允许 create/update 同时声明最终位置，避免再发送独立 move。 */
function create_change_parameters(
  entry_parameters:
    | typeof GLOSSARY_ENTRY_PARAMETERS
    | typeof REPLACEMENT_ENTRY_PARAMETERS
    | typeof TEXT_PRESERVE_ENTRY_PARAMETERS,
) {
  const before_entry_id = Type.Optional(Type.Union([Type.String(), Type.Null()]));
  return Type.Array(
    Type.Union([
      Type.Object(
        { action: Type.Literal("create"), entry: entry_parameters, before_entry_id },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          action: Type.Literal("update"),
          entry_id: Type.String(),
          entry: entry_parameters,
          before_entry_id,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { action: Type.Literal("delete"), entry_id: Type.String() },
        { additionalProperties: false },
      ),
    ]),
  );
}

/** 质量写入只依赖 quality section revision。 */
const EXPECTED_QUALITY_REVISION_PARAMETERS = Type.Object(
  { quality: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

/** 查询入口只接收规则 kind。 */
const QUERY_QUALITY_RULES_PARAMETERS = Type.Object(
  { rule_type: RULE_TYPE_PARAMETERS },
  { additionalProperties: false },
);

/** 更新 schema 保持 rule kind、条目形状与 meta 匹配；根节点显式 object 兼容模型工具协议。 */
const UPDATE_QUALITY_RULES_PARAMETERS = Type.Union(
  [
    Type.Object(
      {
        rule_type: Type.Literal("glossary"),
        changes: Type.Optional(create_change_parameters(GLOSSARY_ENTRY_PARAMETERS)),
        meta: Type.Optional(
          Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
        ),
        expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        rule_type: Type.Union([Type.Literal("pre_replacement"), Type.Literal("post_replacement")]),
        changes: Type.Optional(create_change_parameters(REPLACEMENT_ENTRY_PARAMETERS)),
        meta: Type.Optional(
          Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
        ),
        expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        rule_type: Type.Literal("text_preserve"),
        changes: Type.Optional(create_change_parameters(TEXT_PRESERVE_ENTRY_PARAMETERS)),
        meta: Type.Optional(
          Type.Object(
            {
              mode: Type.Union([
                Type.Literal("off"),
                Type.Literal("smart"),
                Type.Literal("custom"),
              ]),
            },
            { additionalProperties: false },
          ),
        ),
        expected_section_revisions: EXPECTED_QUALITY_REVISION_PARAMETERS,
      },
      { additionalProperties: false },
    ),
  ],
  { type: "object" },
);

type QualityRuleChange = {
  action: "create" | "update" | "delete";
  entry_id?: string;
  entry?: JsonRecord;
  before_entry_id?: string | null;
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
        const execution_signal = signal ?? new AbortController().signal;
        const changes = params.changes ?? [];
        if (changes.length === 0 && params.meta === undefined) {
          throw new Error("质量规则更新至少需要 changes 或 meta");
        }
        // 更新只读取规则结构；术语语料统计统一留给 prospective 集合，避免同一写入扫描两次。
        const current = read_agent_quality_rules_snapshot(
          dependencies.qualityRules,
          params.rule_type,
        );
        const applied =
          changes.length === 0
            ? undefined
            : apply_agent_quality_rule_changes({
                rule_type: params.rule_type,
                current_entries: current.entries,
                changes,
              });
        if (params.rule_type === "glossary" && applied !== undefined) {
          const statistics = await compute_glossary_statistics(
            dependencies,
            applied.entries,
            execution_signal,
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
            rule_type: params.rule_type,
            ...(applied === undefined ? {} : { entries: applied.entries }),
            ...(params.meta === undefined ? {} : { meta: params.meta }),
            expected_section_revisions: params.expected_section_revisions,
          },
          AGENT_QUALITY_RULE_UPDATE_SOURCE,
        );
        const change = write_result.changes.at(-1);
        return tool_result({
          accepted: true,
          rule_type: params.rule_type,
          projectPath: change?.projectPath ?? current.projectPath,
          sectionRevisions: change?.sectionRevisions ?? current.sectionRevisions,
          affected_entries:
            applied?.entries.filter((entry) =>
              applied.affected_entry_ids.includes(String(entry["entry_id"] ?? "")),
            ) ?? [],
          deleted_entry_ids: applied?.deleted_entry_ids ?? [],
          meta: params.meta ?? current.meta,
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
  const statistics = await compute_glossary_statistics(dependencies, glossary_entries, signal);
  result.entries = glossary_entries.map((entry) =>
    enrich_glossary_entry(entry, statistics.matched_count_by_entry_id[entry.entry_id] ?? 0),
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
  const raw_entries = Array.isArray(quality_rule["entries"])
    ? quality_rule["entries"].filter(is_json_record)
    : [];
  const entries = ensure_quality_rule_entry_ids(
    raw_entries.map((entry) => normalize_stored_entry(rule_type, entry)),
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
      if (change.entry === undefined) throw new Error("create 变更缺少 entry");
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
    if (change.entry === undefined) throw new Error("update 变更缺少 entry");
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
  const entry_id = String(entry["entry_id"] ?? "").trim();
  if (rule_type === "glossary") {
    return normalize_glossary_rule_entry(entry, entry_id);
  }
  if (rule_type === "text_preserve") {
    return {
      entry_id,
      src: String(entry["src"] ?? "").trim(),
      info: String(entry["info"] ?? "").trim(),
    };
  }
  return {
    entry_id,
    src: String(entry["src"] ?? "").trim(),
    dst: String(entry["dst"] ?? "").trim(),
    regex: entry["regex"] === true,
    case_sensitive: entry["case_sensitive"] === true,
  };
}

/** 写入条目统一裁剪文本、固定不可写字段并执行规则专属校验。 */
function normalize_writable_entry(rule_type: QualityRuleKind, entry: JsonRecord): JsonRecord {
  const src = String(entry["src"] ?? "").trim();
  if (src === "") throw new Error("质量规则 src 去空白后不能为空");
  if (rule_type === "glossary") {
    const dst = String(entry["dst"] ?? "").trim();
    const case_sensitive = entry["case_sensitive"] === true;
    if (dst === "") throw new Error("术语 dst 去空白后不能为空");
    return {
      src,
      dst,
      info: String(entry["info"] ?? "").trim(),
      regex: false,
      case_sensitive,
    };
  }
  if (rule_type === "text_preserve") {
    assert_valid_regex(src, "文本保护 src");
    return {
      src,
      dst: "",
      info: String(entry["info"] ?? "").trim(),
      regex: false,
      case_sensitive: false,
    };
  }

  const dst = String(entry["dst"] ?? "").trim();
  const regex = entry["regex"] === true;
  const case_sensitive = entry["case_sensitive"] === true;
  const match_text = rule_type === "pre_replacement" ? src : dst;
  if (match_text === "") throw new Error("替换规则匹配文本去空白后不能为空");
  if (regex) assert_valid_regex(match_text, "替换规则匹配文本");
  return { src, dst, info: "", regex, case_sensitive };
}

/** 用共享文本模式编译器校验正则，并保留原始异常作为 cause。 */
function assert_valid_regex(source: string, field: string): void {
  try {
    compile_text_pattern({
      source_text: source,
      mode: "regex",
      case_sensitive: false,
      global: true,
      trim: false,
    });
  } catch (error) {
    throw new Error(`${field} 不是合法正则`, { cause: error });
  }
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

type GlossaryRuleEntry = JsonRecord & {
  entry_id: string;
  src: string;
  dst: string;
  info: string;
  regex: boolean;
  case_sensitive: boolean;
};

type GlossaryEntry = GlossaryRuleEntry & {
  matched_item_count: number;
  fact_violations: string[];
};

/** 术语持久化投影不携带统计字段，避免 Agent 派生事实回写规则存储。 */
function normalize_glossary_rule_entry(entry: JsonRecord, entry_id: string): GlossaryRuleEntry {
  const src = String(entry["src"] ?? "").trim();
  if (src === "") throw new Error("术语 src 去空白后不能为空");
  return {
    entry_id,
    src,
    dst: String(entry["dst"] ?? "").trim(),
    info: String(entry["info"] ?? "").trim(),
    regex: entry["regex"] === true,
    case_sensitive: entry["case_sensitive"] === true,
  };
}

/** 术语读取统一补齐事实分析字段的空初值。 */
function normalize_glossary_entry(entry: JsonRecord): GlossaryEntry {
  const normalized = normalize_glossary_rule_entry(entry, String(entry["entry_id"] ?? ""));
  return {
    ...normalized,
    matched_item_count: 0,
    fact_violations: [],
  };
}

/** 只附加机器可判事实，不替代模型的语义审校。 */
function enrich_glossary_entry(entry: GlossaryEntry, matched_item_count: number): GlossaryEntry {
  const fact_violations: string[] = [];
  if (matched_item_count === 0) fact_violations.push("zero_occurrence");
  if (entry.dst === "") fact_violations.push("empty_dst");
  if (entry.regex) fact_violations.push("regex_enabled");
  return { ...entry, matched_item_count, fact_violations };
}

/** 汇总重复、包含与共享前缀三类候选关系。 */
function build_glossary_structure(
  entries: GlossaryEntry[],
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
  dependencies: Pick<AgentQualityDependencies, "cache" | "computeWorker">,
  entries: JsonRecord[],
  signal: AbortSignal,
): Promise<{
  matched_count_by_entry_id: Record<string, number>;
  subset_parent_labels_by_entry_id: Record<string, string[]>;
}> {
  const result = await dependencies.computeWorker.run(
    {
      type: "quality_statistics",
      input: prepare_quality_statistics_task_input({
        rule_key: "glossary" satisfies QualityStatisticsRuleMode,
        entries,
        items: dependencies.cache.items.readItems(),
      }),
    },
    signal,
  );
  return {
    matched_count_by_entry_id: read_number_record(result["matched_count_by_entry_id"]),
    subset_parent_labels_by_entry_id: read_string_array_record(
      result["subset_parent_labels_by_entry_id"],
    ),
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
