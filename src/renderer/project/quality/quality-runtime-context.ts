import type { QualityRulesRuntimeState } from "@/project/quality/quality-runtime-state";
import {
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
  type TextPreserveRule,
} from "@shared/text/text-preserve-rules";
import { compile_text_pattern, replace_text_pattern } from "@shared/text/text-pattern";
import type { TextJsonRecord } from "@shared/text/text-types";

export type QualityRuntimeGlossaryEntry = {
  src: string;
  dst: string;
};

export type QualityRuntimeGlossaryTerm = [string, string];

type QualityRuntimeGlossaryAhoNode = {
  next: Map<string, number>;
  fail: number;
  entries: QualityRuntimeGlossaryEntry[];
};

export type QualityRuntimeGlossaryIndex = {
  entries: QualityRuntimeGlossaryEntry[];
  aho_nodes: QualityRuntimeGlossaryAhoNode[];
};

export type QualityRuntimeReplacementRule = {
  search_text: string; // 运行态实际匹配文本，译后替换会使用规则 dst
  replace_text: string; // 命中后写入文本，译后替换会回到规则 src
  is_regex: boolean; // 是否按正则编译 search_text
  case_sensitive: boolean; // 是否保留大小写敏感匹配
};

export type QualityRuntimeContext = {
  glossary: QualityRuntimeGlossaryIndex;
  pre_replacements: QualityRuntimeReplacementRule[];
  post_replacements: QualityRuntimeReplacementRule[];
};

export type QualityRuntimeRuleType =
  | "glossary"
  | "pre_replacement"
  | "post_replacement"
  | "text_preserve";

/**
 * 校对页只消费文本保护规则的 src 字段，转换后交给共享规则入口解析
 */
function normalize_text_preserve_entries(
  entries: Array<Record<string, unknown>>,
): TextJsonRecord[] {
  return entries.map((entry) => {
    return { src: String(entry.src ?? "") };
  });
}

/**
 * 质量规则依赖签名只记录会改变匹配结果的字段，统计规划和校对缓存共用这个口径
 */
export function buildQualityRuleDependencyParts(args: {
  ruleType: QualityRuntimeRuleType;
  entry: Record<string, unknown>;
}): unknown[] {
  const src = String(args.entry.src ?? "");
  if (args.ruleType === "glossary") {
    return [args.ruleType, src, Boolean(args.entry.case_sensitive)];
  }
  if (args.ruleType === "text_preserve") {
    return [args.ruleType, src];
  }
  return [args.ruleType, src, Boolean(args.entry.regex), Boolean(args.entry.case_sensitive)];
}

/**
 * 根据文本保护模式构建样例保护规则，renderer 不再自行解释保护正则
 */
export function createQualityTextPreserveRule(args: {
  mode: string;
  text_type: string;
  entries: Array<Record<string, unknown>>;
}): TextPreserveRule | null {
  return build_text_preserve_rule({
    mode: args.mode,
    text_type: args.text_type,
    entries: normalize_text_preserve_entries(args.entries),
    kind: "sample",
  });
}

/**
 * 相似度比较前剥离保护段，保证占位符差异不会支配文本距离
 */
export function stripQualityPreservedSegments(
  text: string,
  sample_rule: TextPreserveRule | null,
): string {
  if (sample_rule === null) {
    return text;
  }

  return sample_rule.replace(text, "");
}

/**
 * 保护段比较只看非空片段，空白差异不应触发文本保护失败
 */
export function collectNonBlankQualityPreservedSegments(
  text: string,
  sample_rule: TextPreserveRule | null,
): string[] {
  if (sample_rule === null) {
    return [];
  }

  return collect_non_blank_text_preserve_segments(text, sample_rule);
}

/**
 * 把启用的替换规则编译成最小运行时结构，调用方不用重复解释 src/dst 方向
 */
function build_replacement_rules(args: {
  enabled: boolean;
  entries: Array<{ src?: unknown; dst?: unknown; regex?: unknown; case_sensitive?: unknown }>;
  source_key: "src" | "dst";
  target_key: "src" | "dst";
}): QualityRuntimeReplacementRule[] {
  if (!args.enabled) {
    return [];
  }

  return args.entries.flatMap((entry) => {
    const search_text = String(entry[args.source_key] ?? "");
    if (search_text === "") {
      return [];
    }

    return [
      {
        search_text,
        replace_text: String(entry[args.target_key] ?? ""),
        is_regex: entry.regex === true,
        case_sensitive: entry.case_sensitive === true,
      },
    ];
  });
}

/**
 * 术语编译成 Aho-Corasick 自动机，校对逐项检查时只扫描一次源文。
 */
function build_glossary_index(quality: QualityRulesRuntimeState): QualityRuntimeGlossaryIndex {
  if (!quality.glossary.enabled) {
    return {
      entries: [],
      aho_nodes: create_empty_glossary_aho_nodes(),
    };
  }

  const entries = quality.glossary.entries.flatMap((entry) => {
    const src = String(entry.src ?? "");
    const dst = String(entry.dst ?? "");
    return src === "" ? [] : [{ src, dst }];
  });

  return {
    entries,
    aho_nodes: build_glossary_aho_nodes(entries),
  };
}

/**
 * 空自动机保留根节点，扫描逻辑无需为禁用 glossary 分叉特殊状态。
 */
function create_empty_glossary_aho_nodes(): QualityRuntimeGlossaryAhoNode[] {
  return [
    {
      next: new Map(),
      fail: 0,
      entries: [],
    },
  ];
}

/**
 * 构建 failure links 并继承 fallback 终点，保证嵌套术语和后缀术语都能命中。
 */
function build_glossary_aho_nodes(
  entries: QualityRuntimeGlossaryEntry[],
): QualityRuntimeGlossaryAhoNode[] {
  const nodes = create_empty_glossary_aho_nodes();

  entries.forEach((entry) => {
    let node_index = 0;
    for (const character of Array.from(entry.src)) {
      const node = nodes[node_index];
      const next_index = node.next.get(character);
      if (next_index !== undefined) {
        node_index = next_index;
        continue;
      }

      const created_index = nodes.length;
      node.next.set(character, created_index);
      nodes.push({
        next: new Map(),
        fail: 0,
        entries: [],
      });
      node_index = created_index;
    }
    nodes[node_index].entries.push(entry);
  });

  const queue: number[] = [];
  for (const child_index of nodes[0].next.values()) {
    nodes[child_index].fail = 0;
    queue.push(child_index);
  }

  for (let queue_index = 0; queue_index < queue.length; queue_index += 1) {
    const current_index = queue[queue_index];
    const current_node = nodes[current_index];

    for (const [character, child_index] of current_node.next) {
      let fallback_index = current_node.fail;
      while (fallback_index !== 0 && !nodes[fallback_index].next.has(character)) {
        fallback_index = nodes[fallback_index].fail;
      }

      nodes[child_index].fail = nodes[fallback_index].next.get(character) ?? 0;
      nodes[child_index].entries.push(...nodes[nodes[child_index].fail].entries);
      queue.push(child_index);
    }
  }

  return nodes;
}

/**
 * 质量运行时上下文把 UI 规则快照编译成校对和统计都能复用的可执行结构
 */
export function buildQualityRuntimeContext(
  quality: QualityRulesRuntimeState,
): QualityRuntimeContext {
  return {
    glossary: build_glossary_index(quality),
    pre_replacements: build_replacement_rules({
      enabled: quality.pre_replacement.enabled,
      entries: quality.pre_replacement.entries,
      source_key: "src",
      target_key: "dst",
    }),
    post_replacements: build_replacement_rules({
      enabled: quality.post_replacement.enabled,
      entries: quality.post_replacement.entries,
      source_key: "dst",
      target_key: "src",
    }),
  };
}

/**
 * 替换规则先作用于源文和译文副本，后续术语/相似度检查都读取替换后的文本
 */
export function applyQualityRuntimeReplacements(
  item: { src: string; dst: string },
  quality_context: QualityRuntimeContext,
): { src_replaced: string; dst_replaced: string } {
  let src_replaced = item.src;
  let dst_replaced = item.dst;

  for (const entry of quality_context.pre_replacements) {
    src_replaced = apply_quality_runtime_replacement(src_replaced, entry);
  }

  for (const entry of quality_context.post_replacements) {
    dst_replaced = apply_quality_runtime_replacement(dst_replaced, entry);
  }

  return {
    src_replaced,
    dst_replaced,
  };
}

/**
 * 校对质量运行态按任务替换规则执行，避免统计和任务管线解释出两套结果
 */
function apply_quality_runtime_replacement(
  text: string,
  entry: QualityRuntimeReplacementRule,
): string {
  const pattern = compile_text_pattern({
    source_text: entry.search_text,
    mode: entry.is_regex ? "regex" : "literal",
    case_sensitive: entry.case_sensitive,
    global: true,
    trim: false,
  });
  if (pattern === null) {
    return text;
  }
  return replace_text_pattern({
    text,
    pattern,
    replacement_text: entry.replace_text,
    replacement_syntax: entry.is_regex ? "backslash" : "literal",
  }).text;
}

/**
 * Aho 自动机按源文单次扫描收集命中术语，输出保持同一 src/dst 只出现一次。
 */
function collect_matched_glossary_entries(args: {
  glossary: QualityRuntimeGlossaryIndex;
  src_replaced: string;
}): QualityRuntimeGlossaryEntry[] {
  if (args.glossary.entries.length === 0) {
    return [];
  }

  const matched_entries = new Map<string, QualityRuntimeGlossaryEntry>();
  let node_index = 0;
  for (const character of Array.from(args.src_replaced)) {
    while (node_index !== 0 && !args.glossary.aho_nodes[node_index].next.has(character)) {
      node_index = args.glossary.aho_nodes[node_index].fail;
    }

    node_index = args.glossary.aho_nodes[node_index].next.get(character) ?? 0;
    for (const entry of args.glossary.aho_nodes[node_index].entries) {
      matched_entries.set(`${entry.src}\u0000${entry.dst}`, entry);
    }
  }

  return [...matched_entries.values()];
}

/**
 * 术语命中判断集中在质量运行时，避免校对页和统计页各自解释 glossary
 */
export function partitionQualityRuntimeGlossaryTerms(args: {
  glossary: QualityRuntimeGlossaryIndex;
  src_replaced: string;
  dst_replaced: string;
}): {
  failed_terms: QualityRuntimeGlossaryTerm[];
  applied_terms: QualityRuntimeGlossaryTerm[];
} {
  const failed_terms: QualityRuntimeGlossaryTerm[] = [];
  const applied_terms: QualityRuntimeGlossaryTerm[] = [];

  for (const entry of collect_matched_glossary_entries({
    glossary: args.glossary,
    src_replaced: args.src_replaced,
  })) {
    const term: QualityRuntimeGlossaryTerm = [entry.src, entry.dst];
    if (args.dst_replaced.includes(entry.dst)) {
      applied_terms.push(term);
    } else {
      failed_terms.push(term);
    }
  }

  return {
    failed_terms,
    applied_terms,
  };
}
