import type { ProjectStoreQualityState } from "@/project/store/project-store";
import {
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
  type TextPreserveRule,
} from "@shared/text/text-preserve-rules";
import type { TextJsonRecord } from "@shared/text/text-types";

export type QualityRuntimeGlossaryEntry = {
  src: string;
  dst: string;
};

export type QualityRuntimeGlossaryTerm = [string, string];

export type QualityRuntimeGlossaryIndex = {
  entries: QualityRuntimeGlossaryEntry[];
  entry_by_first_character: Map<string, QualityRuntimeGlossaryEntry[]>;
};

export type QualityRuntimeReplacementRule = {
  search_text: string;
  replace_text: string;
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
 * literal 替换保持旧逻辑的空 src 行为，避免替换规则语义在共享后漂移
 */
function replace_all_literal(text: string, search_text: string, replace_text: string): string {
  if (search_text === "") {
    return `${replace_text}${Array.from(text).join(replace_text)}${replace_text}`;
  }

  return text.split(search_text).join(replace_text);
}

/**
 * 把启用的替换规则编译成最小运行时结构，调用方不用重复解释 src/dst 方向
 */
function build_replacement_rules(args: {
  enabled: boolean;
  entries: Array<{ src?: unknown; dst?: unknown }>;
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
      },
    ];
  });
}

/**
 * 术语按首字符分桶，校对逐项检查时只扫描可能命中的术语集合
 */
function build_glossary_index(quality: ProjectStoreQualityState): QualityRuntimeGlossaryIndex {
  if (!quality.glossary.enabled) {
    return {
      entries: [],
      entry_by_first_character: new Map(),
    };
  }

  const entries = quality.glossary.entries.flatMap((entry) => {
    const src = String(entry.src ?? "");
    const dst = String(entry.dst ?? "");
    return src === "" ? [] : [{ src, dst }];
  });
  const entry_by_first_character = new Map<string, QualityRuntimeGlossaryEntry[]>();
  entries.forEach((entry) => {
    const first_character = Array.from(entry.src)[0] ?? "";
    const bucket = entry_by_first_character.get(first_character) ?? [];
    bucket.push(entry);
    entry_by_first_character.set(first_character, bucket);
  });

  return {
    entries,
    entry_by_first_character,
  };
}

/**
 * 质量运行时上下文把 UI 规则快照编译成校对和统计都能复用的可执行结构
 */
export function buildQualityRuntimeContext(
  quality: ProjectStoreQualityState,
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
    src_replaced = replace_all_literal(src_replaced, entry.search_text, entry.replace_text);
  }

  for (const entry of quality_context.post_replacements) {
    dst_replaced = replace_all_literal(dst_replaced, entry.search_text, entry.replace_text);
  }

  return {
    src_replaced,
    dst_replaced,
  };
}

/**
 * 只从源文中实际出现过首字符的术语桶收集候选，降低大术语表的逐项扫描成本
 */
function collect_candidate_glossary_entries(args: {
  glossary: QualityRuntimeGlossaryIndex;
  src_replaced: string;
}): QualityRuntimeGlossaryEntry[] {
  if (args.glossary.entries.length === 0) {
    return [];
  }

  const candidate_entries = new Map<string, QualityRuntimeGlossaryEntry>();
  Array.from(args.src_replaced).forEach((character) => {
    const bucket = args.glossary.entry_by_first_character.get(character);
    if (bucket === undefined) {
      return;
    }

    bucket.forEach((entry) => {
      candidate_entries.set(`${entry.src}\u0000${entry.dst}`, entry);
    });
  });

  return [...candidate_entries.values()];
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

  for (const entry of collect_candidate_glossary_entries({
    glossary: args.glossary,
    src_replaced: args.src_replaced,
  })) {
    if (!args.src_replaced.includes(entry.src)) {
      continue;
    }

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
