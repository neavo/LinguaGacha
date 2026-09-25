import {
  QualityRule,
  type QualityRuleGlossaryEntry,
  type TextPreserveEntry,
  type TextReplacementEntry,
} from "../../domain/quality";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import type {
  ProofreadingEvaluation,
  ProofreadingItemRecord,
  ProofreadingWarning,
} from "./proofreading-types";
import { PROOFREADING_WARNING_CODES } from "./proofreading-types";
import { read_item_name_text, read_optional_item_name_text } from "../item-name";
import {
  build_text_preserve_rule,
  type TextPreserveAnalysis,
  type TextPreserveRule,
} from "../text/text-preserve-rules";
import {
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../text/text-replacement-rules";
import { prepare_translation_source } from "../text/translation-source";
import type { TextProcessingConfig } from "../text/text-types";
import {
  collect_foreign_residue_fragments,
  has_translation_retry_reached_review_threshold,
  has_translation_similarity_issue,
} from "../text/translation-quality-rules";
import {
  has_item_translation_text,
  read_item_source_text_parts,
  read_item_translation_text_parts,
} from "../item-text";
import {
  evaluate_glossary_applications,
  compile_glossary,
  match_glossary_source,
  type CompiledGlossary,
} from "../quality/glossary";
import { normalize_quality_rule_entries } from "../quality/quality-rule-entry";
import { split_text_lines } from "../text/text-lines";
import {
  project_text_resource_references,
  restore_text_resource_references,
  type TextResourceReferenceMapping,
} from "../text/text-resource-reference";
import { has_punctuation_structure_mismatch } from "../text/punctuation-structure";

export type ProofreadingEvaluationContext = {
  glossary: CompiledGlossary; // 术语始终按原始 src/name_src 命中
  pre_replacements: CompiledTextReplacements | null; // 仅译前规则参与源文校对
  text_preserve_entries: TextPreserveEntry[]; // 按 item 文本类型延迟编译的规范规则
};

/** 一次解析质量快照并验证全部校对规则，禁用态也不能掩盖损坏事实。 */
export function buildProofreadingEvaluationContext(
  quality: QualitySnapshot,
): ProofreadingEvaluationContext {
  const glossary_entries = normalize_quality_rule_entries(
    QualityRule.from_json("glossary"),
    quality.glossary.entries,
  ) as QualityRuleGlossaryEntry[];
  const pre_entries = normalize_quality_rule_entries(
    QualityRule.from_json("pre_replacement"),
    quality.pre_replacement.entries,
  ) as TextReplacementEntry[];
  return {
    glossary: compile_glossary(quality.glossary.enabled ? glossary_entries : []),
    pre_replacements:
      quality.pre_replacement.enabled && pre_entries.length > 0
        ? compile_text_replacements(pre_entries)
        : null,
    text_preserve_entries: normalize_quality_rule_entries(
      QualityRule.from_json("text_preserve"),
      quality.text_preserve.entries,
    ) as TextPreserveEntry[],
  };
}

// 跳过类状态仍要进入筛选统计，但不参与警告计算。
const PROOFREADING_SKIPPED_WARNING_STATUSES = new Set([
  "NONE",
  "RULE_SKIPPED",
  "LANGUAGE_SKIPPED",
  "EXCLUDED",
  "DUPLICATED",
]);

type ProofreadingPreservedSegment = { line_index: number; value: string };

type ProofreadingTextAnalysis = Pick<TextPreserveAnalysis, "segments" | "unpreserved_text">;

type ProofreadingTextPair = {
  target_field: "dst" | "name_dst";
  source_analysis: ProofreadingTextAnalysis[];
  translation_analysis: ProofreadingTextAnalysis[];
};

/** 临时编号仅属于翻译输入，校对按真实保护值比较，避免不同链接使用同一编号时漏报。 */
function read_proofreading_analysis(
  analysis: TextPreserveAnalysis,
  mappings: readonly TextResourceReferenceMapping[],
): ProofreadingTextAnalysis {
  return {
    segments: analysis.segments.map((value) => restore_text_resource_references(value, mappings)),
    unpreserved_text: analysis.unpreserved_text,
  };
}

/** 分别保存两侧的差异，证据基于准备后的文本，不声明原始编辑器坐标。 */
function compare_preserved_segments(pair: ProofreadingTextPair): ProofreadingWarning | null {
  const source = collect_non_blank_segments_by_line(pair.source_analysis);
  const translation = collect_non_blank_segments_by_line(pair.translation_analysis);
  const source_fragments = new Set<string>();
  const translation_fragments = new Set<string>();
  for (let index = 0; index < Math.max(source.length, translation.length); index += 1) {
    const left = source[index];
    const right = translation[index];
    if (left?.line_index === right?.line_index && left?.value === right?.value) continue;
    if (left !== undefined) source_fragments.add(left.value);
    if (right !== undefined) translation_fragments.add(right.value);
  }
  return source_fragments.size === 0 && translation_fragments.size === 0
    ? null
    : {
        code: "TEXT_PRESERVE",
        target_field: pair.target_field,
        source_fragments: [...source_fragments],
        translation_fragments: [...translation_fragments],
      };
}

/** 正文与姓名共用判断算法；调用方负责遵循各字段实际的翻译准备语义。 */
function evaluate_text_pair(
  pair: ProofreadingTextPair,
  config: TextProcessingConfig,
): ProofreadingWarning[] {
  const warnings: ProofreadingWarning[] = [];
  const natural_src = pair.source_analysis.map((line) => line.unpreserved_text).join("\n");
  const natural_dst = pair.translation_analysis.map((line) => line.unpreserved_text).join("\n");
  const fragments = collect_foreign_residue_fragments({
    text: natural_dst,
    targetLanguage: config.target_language,
  });
  if (fragments.length > 0) {
    warnings.push({ code: "FOREIGN_CHAR_RESIDUE", target_field: pair.target_field, fragments });
  }
  const preserve_warning = compare_preserved_segments(pair);
  if (preserve_warning !== null) warnings.push(preserve_warning);
  if (has_punctuation_structure_mismatch({ src: natural_src, dst: natural_dst })) {
    warnings.push({ code: "PUNCTUATION_MISMATCH", target_field: pair.target_field });
  }
  // 姓名允许保留原名，现有相似度算法只用于正文。
  if (
    pair.target_field === "dst" &&
    has_translation_similarity_issue({
      src: natural_src,
      dst: natural_dst,
      sourceLanguage: config.source_language,
      targetLanguage: config.target_language,
      has_foreign_residue: fragments.length > 0,
    })
  ) {
    warnings.push({ code: "SIMILARITY", target_field: "dst" });
  }
  return warnings;
}

/** 单条记录的警告在这里生成，列表、统计、编辑窗和 Agent 消费同一份字段级结果。 */
export function evaluateProofreadingItem(args: {
  item: ProofreadingItemRecord;
  quality_context: ProofreadingEvaluationContext;
  quality: QualitySnapshot;
  processingConfig: TextProcessingConfig;
  sample_rule_cache: Map<string, TextPreserveRule>;
}): ProofreadingEvaluation {
  const { item } = args;
  const warnings: ProofreadingWarning[] = [];
  if (PROOFREADING_SKIPPED_WARNING_STATUSES.has(item.status) || !has_item_translation_text(item)) {
    return { warnings, glossary_applications: [] };
  }
  const sample_rule_cache_key = `${item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`;
  let sample_rule = args.sample_rule_cache.get(sample_rule_cache_key);
  if (sample_rule === undefined) {
    sample_rule = build_text_preserve_rule({
      mode: args.quality.text_preserve.mode,
      text_type: item.text_type,
      entries: args.quality_context.text_preserve_entries,
    });
    args.sample_rule_cache.set(sample_rule_cache_key, sample_rule);
  }
  const prepared = prepare_translation_source({
    src: item.src,
    name_src: read_optional_item_name_text(item.name_src),
    text_type: item.text_type,
    config: args.processingConfig,
    preserve_rule: sample_rule,
    pre_replacements: args.quality_context.pre_replacements,
    start_ordinal: 0,
  });
  if (item.dst !== "") {
    const translation = project_text_resource_references(item.dst);
    // 译前替换可能引入换行，组合后重新分析才能取得实际保护片段行号。
    const source_analysis = prepared.prepared_lines.some((line) =>
      /[\r\n]/u.test(line.prepared_text),
    )
      ? split_text_lines(prepared.prepared_lines.map((line) => line.prepared_text).join("\n")).map(
          (line) => sample_rule.analyze(line),
        )
      : prepared.prepared_lines.map((line) => line.preserve_analysis);
    warnings.push(
      ...evaluate_text_pair(
        {
          target_field: "dst",
          source_analysis: source_analysis.map((analysis) =>
            read_proofreading_analysis(analysis, prepared.body.mappings),
          ),
          translation_analysis: split_text_lines(translation.text).map((line) =>
            read_proofreading_analysis(sample_rule.analyze(line), translation.mappings),
          ),
        },
        args.processingConfig,
      ),
    );
    if (split_text_lines(item.src).length !== split_text_lines(item.dst).length) {
      warnings.push({ code: "LINE_COUNT_MISMATCH", target_field: "dst" });
    }
  }
  const name_dst = read_item_name_text(item.name_dst);
  if (name_dst !== "") {
    const translation = project_text_resource_references(name_dst);
    warnings.push(
      ...evaluate_text_pair(
        {
          target_field: "name_dst",
          source_analysis: [
            read_proofreading_analysis(
              sample_rule.analyze(prepared.name?.text ?? ""),
              prepared.name?.mappings ?? [],
            ),
          ],
          translation_analysis: [
            read_proofreading_analysis(sample_rule.analyze(translation.text), translation.mappings),
          ],
        },
        args.processingConfig,
      ),
    );
  }

  const glossary_applications = evaluate_glossary_applications(
    args.quality_context.glossary,
    match_glossary_source(args.quality_context.glossary, read_item_source_text_parts(item)),
    read_item_translation_text_parts(item),
  );
  for (const target_field of ["dst", "name_dst"] as const) {
    if (
      glossary_applications.some((application) =>
        application.fields.some((field) => field.target_field === target_field && !field.applied),
      )
    ) {
      warnings.push({ code: "GLOSSARY", target_field });
    }
  }
  if (has_translation_retry_reached_review_threshold(item.retry_count)) {
    warnings.push({ code: "RETRY_THRESHOLD", target_field: null });
  }
  warnings.sort(
    (left, right) =>
      PROOFREADING_WARNING_CODES.indexOf(left.code) -
      PROOFREADING_WARNING_CODES.indexOf(right.code),
  );
  return { warnings, glossary_applications };
}

/** 按原行号收集非空保护片段，供源文与译文做精确对照。 */
function collect_non_blank_segments_by_line(
  lines: readonly ProofreadingTextAnalysis[],
): ProofreadingPreservedSegment[] {
  return lines.flatMap((line, line_index) =>
    line.segments.filter((value) => value.trim() !== "").map((value) => ({ line_index, value })),
  );
}
