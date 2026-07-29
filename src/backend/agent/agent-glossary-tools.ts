import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

import type { JsonRecord } from "../../domain/json";
import { is_json_record, read_json_record } from "../../domain/json";
import { collect_quality_rule_duplicate_groups } from "../../shared/quality/quality-rule-import";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "../../shared/quality/quality-rule-entry-id";
import {
  count_quality_literal_matches,
  run_quality_statistics_task_sync,
} from "../../shared/quality/quality-statistics";
import { JsonTool } from "../../shared/utils/json-tool";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleService } from "../quality/quality-rule-service";
import { collect_agent_corpus_match_texts } from "./agent-corpus-tools";

const WRITE_GLOSSARY_PARAMETERS = Type.Object(
  {
    changes: Type.Array(
      Type.Object(
        {
          action: Type.Union([
            Type.Literal("create"),
            Type.Literal("update"),
            Type.Literal("delete"),
          ]),
          entry_id: Type.Optional(Type.String()),
          entry: Type.Optional(
            Type.Object(
              {
                src: Type.String(),
                dst: Type.String(),
                info: Type.String(),
                case_sensitive: Type.Boolean(),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    expected_section_revisions: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

type GlossaryEntry = JsonRecord & {
  entry_id: string;
  src: string;
  dst: string;
  info: string;
  regex: boolean;
  case_sensitive: boolean;
  exact_occurrences: number; // 当前全量原文中的实际出现次数，只作为 Agent 读投影
  fact_violations: string[]; // 可机器判定的事实信号，不替代模型的语义审校
};

type AgentGlossaryCache = {
  readonly items: Pick<CacheReadPort["items"], "readItems">;
};

type AgentGlossaryQualityRules = Pick<QualityRuleService, "read" | "save_rule_entries">;

/**
 * 提供 read/write 共用的术语事实源；缓存与质量规则都由组合根注入同一权威实例。
 */
type AgentGlossaryFactSource = {
  qualityRules: Pick<AgentGlossaryQualityRules, "read">;
  cache: AgentGlossaryCache;
};

type AgentGlossaryToolDependencies = Omit<AgentGlossaryFactSource, "qualityRules"> & {
  qualityRules: AgentGlossaryQualityRules;
  beginWrite: () => void;
  endWrite: () => void;
};

/**
 * 构造术语只读分析与原子写入工具；写入仍委托质量规则唯一入口。
 */
export function create_agent_glossary_tools(
  dependencies: AgentGlossaryToolDependencies,
): AgentTool[] {
  return [
    {
      name: "read_glossary",
      label: "读术语",
      description: "读取当前工程完整术语表、出现次数、事实违规、结构关系和 quality revision。",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        return tool_result(read_agent_glossary(dependencies));
      },
    },
    {
      name: "write_glossary",
      label: "写术语",
      description: "把完整变更集按 expected_section_revisions 原子写入当前工程术语表。",
      executionMode: "sequential",
      parameters: WRITE_GLOSSARY_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const request = params as {
          changes: Parameters<typeof apply_agent_glossary_changes>[1];
          expected_section_revisions: Record<string, number>;
        };
        dependencies.beginWrite();
        try {
          const current = read_agent_glossary(dependencies);
          const occurrence_lookup = build_occurrence_lookup(dependencies.cache.items.readItems());
          const entries = apply_agent_glossary_changes(
            current.entries,
            request.changes,
            occurrence_lookup,
          );
          await dependencies.qualityRules.save_rule_entries({
            rule_type: "glossary",
            entries,
            expected_section_revisions: request.expected_section_revisions,
          });
          return tool_result(read_agent_glossary(dependencies));
        } finally {
          dependencies.endWrite();
        }
      },
    },
  ];
}

/**
 * 从权威规则与缓存语料生成术语快照，机器事实只作为返回投影而不进入存储。
 */
export function read_agent_glossary(fact_source: AgentGlossaryFactSource): JsonRecord & {
  entries: GlossaryEntry[];
} {
  const payload = fact_source.qualityRules.read({ rule_type: "glossary" });
  const quality_rule = read_json_record(payload["qualityRule"]);
  const raw_entries = Array.isArray(quality_rule["entries"])
    ? quality_rule["entries"].filter(is_json_record)
    : [];
  const entries = ensure_quality_rule_entry_ids(raw_entries.map(normalize_glossary_entry));
  const exact_occurrences = count_glossary_exact_occurrences(
    entries,
    fact_source.cache.items.readItems(),
  );
  const enriched_entries = entries.map((entry, index) =>
    enrich_glossary_entry(entry, exact_occurrences[index] ?? 0),
  );

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
  const relation_results = run_quality_statistics_task_sync({
    rules: entries.map((entry) => ({
      key: entry.entry_id,
      pattern: entry.src,
      mode: "glossary",
      case_sensitive: entry.case_sensitive,
    })),
    srcTextGroups: [],
    dstTextGroups: [],
    relationCandidates: entries.map((entry) => ({ key: entry.entry_id, src: entry.src })),
  }).results;
  const containment_candidates: JsonRecord[] = entries.flatMap((entry) => {
    const parents = relation_results[entry.entry_id]?.subset_parents ?? [];
    return parents.length === 0 ? [] : [{ entry_id: entry.entry_id, src: entry.src, parents }];
  });

  return {
    entries: enriched_entries,
    sectionRevisions: read_json_record(payload["sectionRevisions"]),
    structure: {
      duplicate_src_groups: duplicate_groups,
      containment_candidates,
      root_candidates: build_shared_prefix_groups(entries.map((entry) => entry.src)),
    },
  };
}

/**
 * 单 pattern 逐条统计出现次数；每条尊重自身 case_sensitive，与 search_corpus 同一 Aho 口径。
 */
function count_glossary_exact_occurrences(entries: GlossaryEntry[], items: JsonRecord[]): number[] {
  const texts = collect_agent_corpus_match_texts(items);
  const totals = Array.from({ length: entries.length }, () => 0);
  for (const case_sensitive of [false, true]) {
    const group = entries.flatMap((entry, index) =>
      entry.case_sensitive === case_sensitive ? [{ index, pattern: entry.src }] : [],
    );
    if (group.length === 0) continue;
    const counts_by_text = count_quality_literal_matches({
      patterns: group.map(({ pattern }) => pattern),
      texts,
      case_sensitive,
    });
    group.forEach(({ index }, pattern_index) => {
      totals[index] = counts_by_text.reduce((sum, counts) => sum + (counts[pattern_index] ?? 0), 0);
    });
  }
  return totals;
}

/**
 * 只标记机器可判事实；分类合法性属于语义判断，留给 prompt 约束，不进代码。
 */
function enrich_glossary_entry(entry: GlossaryEntry, exact_occurrences: number): GlossaryEntry {
  const fact_violations: string[] = [];
  if (exact_occurrences === 0) fact_violations.push("zero_occurrence");
  if (entry.dst === "") fact_violations.push("empty_dst");
  if (entry.regex) fact_violations.push("regex_enabled");
  return { ...entry, exact_occurrences, fact_violations };
}

/**
 * 在内存副本上完整应用变更集；任一非法项抛错时调用方不会触达持久化入口。
 */
export function apply_agent_glossary_changes(
  current_entries: GlossaryEntry[],
  changes: Array<{
    action: "create" | "update" | "delete";
    entry_id?: string;
    entry?: { src: string; dst: string; info: string; case_sensitive: boolean };
  }>,
  occurrence_lookup?: (src: string, case_sensitive: boolean) => number,
): GlossaryEntry[] {
  const entries = current_entries.map((entry) => ({ ...entry }));
  const changed_entry_ids = new Set<string>();

  for (const change of changes) {
    if (change.action === "create") {
      if (change.entry === undefined) throw new Error("create 变更缺少 entry");
      assert_entry_machine_facts(change.entry, occurrence_lookup);
      entries.push({
        ...normalize_glossary_entry(change.entry),
        entry_id: create_quality_rule_entry_id(),
      });
      continue;
    }

    const entry_id = String(change.entry_id ?? "").trim();
    if (entry_id === "" || changed_entry_ids.has(entry_id)) {
      throw new Error("update/delete 需要唯一且非空的 entry_id");
    }
    changed_entry_ids.add(entry_id);
    const index = entries.findIndex((entry) => entry.entry_id === entry_id);
    if (index < 0) throw new Error(`术语条目不存在：${entry_id}`);
    if (change.action === "delete") {
      entries.splice(index, 1);
      continue;
    }
    if (change.entry === undefined) throw new Error("update 变更缺少 entry");
    assert_entry_machine_facts(change.entry, occurrence_lookup);
    entries[index] = { ...normalize_glossary_entry(change.entry), entry_id };
  }

  return entries;
}

/**
 * 为 write 构建按 case_sensitive 缓存的出现次数查询；与 read 共享同一 Aho 统计口径。
 */
function build_occurrence_lookup(
  items: JsonRecord[],
): (src: string, case_sensitive: boolean) => number {
  const texts = collect_agent_corpus_match_texts(items);
  const cache = new Map<string, number>();
  return (src, case_sensitive) => {
    const key = `${case_sensitive ? "1" : "0"}${src}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const counts = count_quality_literal_matches({ patterns: [src], texts, case_sensitive });
    const total = counts.reduce((sum, item_counts) => sum + (item_counts[0] ?? 0), 0);
    cache.set(key, total);
    return total;
  };
}

/**
 * 机器事实校验：只兜「可判定的事实」，dst 非空与 src 必须真实出现在语料；分类合法性交给 prompt。
 */
function assert_entry_machine_facts(
  entry: { src: string; dst: string; case_sensitive: boolean },
  occurrence_lookup: ((src: string, case_sensitive: boolean) => number) | undefined,
): void {
  if (entry.dst.trim() === "") throw new Error("术语 dst 去空白后不能为空");
  if (occurrence_lookup !== undefined && occurrence_lookup(entry.src, entry.case_sensitive) === 0) {
    throw new Error(`术语 src 在语料中零出现：${entry.src}`);
  }
}

/**
 * 将数据库或模型条目收窄为同一术语形状，派生事实在读取阶段重新计算。
 */
function normalize_glossary_entry(entry: JsonRecord): GlossaryEntry {
  const src = String(entry["src"] ?? "").trim();
  if (src === "") throw new Error("术语 src 去空白后不能为空");
  return {
    entry_id: String(entry["entry_id"] ?? ""),
    src,
    dst: String(entry["dst"] ?? "").trim(),
    info: String(entry["info"] ?? "").trim(),
    regex: entry["regex"] === true,
    case_sensitive: entry["case_sensitive"] === true,
    exact_occurrences: 0,
    fact_violations: [],
  };
}

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

function tool_result(details: JsonRecord) {
  return Promise.resolve({
    content: [{ type: "text" as const, text: JsonTool.stringifyStrict(details) }],
    details,
  });
}
