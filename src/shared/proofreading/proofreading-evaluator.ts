import {
  QualityRule,
  type QualityRuleGlossaryEntry,
  type TextPreserveEntry,
  type TextReplacementEntry,
} from "../../domain/quality";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import type {
  ProofreadingClientItem,
  ProofreadingItemRecord,
  ProofreadingWarningFragmentsByCode,
  ProofreadingWarningCode,
} from "./proofreading-types";
import { create_proofreading_client_item } from "./list";
import {
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
  type TextPreserveRule,
} from "../text/text-preserve-rules";
import {
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../text/text-replacement-rules";
import { prepare_translation_source_line } from "../text/translation-source-line";
import type { TextProcessingConfig } from "../text/text-types";
import {
  collect_translation_residue_fragments,
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
  type GlossaryApplication,
} from "../quality/glossary";
import { normalize_quality_rule_entries } from "../quality/quality-rule-entry";
import { split_text_lines } from "../text/text-lines";

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

/**
 * 构造文本保护失败片段时保留源/译两边差异，供编辑弹窗定位。
 */
type ProofreadingPreservedSegment = { line_index: number; value: string };

function build_text_preserve_failed_fragments(args: {
  source_segments: ProofreadingPreservedSegment[];
  translation_segments: ProofreadingPreservedSegment[];
}): string[] {
  const failed_fragments: string[] = [];
  const max_length = Math.max(args.source_segments.length, args.translation_segments.length);

  for (let index = 0; index < max_length; index += 1) {
    const source_segment = args.source_segments[index];
    const translation_segment = args.translation_segments[index];
    if (
      source_segment?.line_index === translation_segment?.line_index &&
      source_segment?.value === translation_segment?.value
    ) {
      continue;
    }

    if (source_segment !== undefined) {
      failed_fragments.push(source_segment.value);
    }
    if (translation_segment !== undefined) {
      failed_fragments.push(translation_segment.value);
    }
  }

  return [...new Set(failed_fragments)];
}

/**
 * 单条 item 的全部校对警告在这里生成，保证列表、面板和弹窗看到同一份判断。
 */
export function evaluateProofreadingItem(args: {
  item: ProofreadingItemRecord;
  quality_context: ProofreadingEvaluationContext;
  quality: QualitySnapshot;
  processingConfig: TextProcessingConfig;
  sample_rule_cache: Map<string, TextPreserveRule | null>;
}): ProofreadingClientItem {
  const warnings: ProofreadingWarningCode[] = [];
  const warning_fragments_by_code: ProofreadingWarningFragmentsByCode = {};
  let glossary_applications: GlossaryApplication[] = [];
  const sample_rule_cache_key = `${args.item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`;
  let sample_rule = args.sample_rule_cache.get(sample_rule_cache_key);
  if (sample_rule === undefined) {
    sample_rule = build_text_preserve_rule({
      mode: args.quality.text_preserve.mode,
      text_type: args.item.text_type,
      entries: args.quality_context.text_preserve_entries,
    });
    args.sample_rule_cache.set(sample_rule_cache_key, sample_rule);
  }

  if (
    PROOFREADING_SKIPPED_WARNING_STATUSES.has(args.item.status) ||
    !has_item_translation_text(args.item)
  ) {
    return create_proofreading_client_item({
      item: args.item,
      warnings,
      warning_fragments_by_code,
      glossary_applications,
    });
  }

  if (args.item.dst !== "") {
    const review_src = split_text_lines(args.item.src)
      .map(
        (raw_text, line_index) =>
          prepare_translation_source_line({
            line_index,
            raw_text,
            text_type: args.item.text_type,
            config: args.processingConfig,
            preserve_rule: sample_rule,
            pre_replacements: args.quality_context.pre_replacements,
          }).prepared_text,
      )
      .join("\n");
    const normalized_dst = strip_preserved_segments_by_line(args.item.dst, sample_rule);
    if (split_text_lines(args.item.src).length !== split_text_lines(args.item.dst).length) {
      warnings.push("LINE_COUNT_MISMATCH");
    }
    const residue_fragments = collect_translation_residue_fragments({
      text: normalized_dst,
      sourceLanguage: args.processingConfig.source_language,
    });
    const kana_fragments = residue_fragments.kana;
    if (kana_fragments.length > 0) {
      warnings.push("KANA");
      warning_fragments_by_code.KANA = kana_fragments;
    }

    const hangeul_fragments = residue_fragments.hangeul;
    if (hangeul_fragments.length > 0) {
      warnings.push("HANGEUL");
      warning_fragments_by_code.HANGEUL = hangeul_fragments;
    }

    const source_preserved_segments = collect_non_blank_segments_by_line(review_src, sample_rule);
    const translation_preserved_segments = collect_non_blank_segments_by_line(
      args.item.dst,
      sample_rule,
    );
    if (
      JSON.stringify(source_preserved_segments) !== JSON.stringify(translation_preserved_segments)
    ) {
      warnings.push("TEXT_PRESERVE");
      warning_fragments_by_code.TEXT_PRESERVE = build_text_preserve_failed_fragments({
        source_segments: source_preserved_segments,
        translation_segments: translation_preserved_segments,
      });
    }

    if (
      has_translation_similarity_issue({
        src: strip_preserved_segments_by_line(review_src, sample_rule),
        dst: normalized_dst,
        sourceLanguage: args.processingConfig.source_language,
        targetLanguage: args.processingConfig.target_language,
      })
    ) {
      warnings.push("SIMILARITY");
    }
  }

  if (args.quality_context.glossary.entries.length > 0) {
    glossary_applications = evaluate_glossary_applications(
      args.quality_context.glossary,
      match_glossary_source(args.quality_context.glossary, read_item_source_text_parts(args.item)),
      read_item_translation_text_parts(args.item),
    );
    if (
      glossary_applications.some((application) =>
        application.fields.some((field) => !field.applied),
      )
    ) {
      warnings.push("GLOSSARY");
    }
  }

  if (has_translation_retry_reached_review_threshold(args.item.retry_count)) {
    warnings.push("RETRY_THRESHOLD");
  }

  return create_proofreading_client_item({
    item: args.item,
    warnings,
    warning_fragments_by_code,
    glossary_applications,
  });
}

/** 逐行移除保护片段，避免正则跨行改变翻译与校对共用的处理语义。 */
function strip_preserved_segments_by_line(text: string, rule: TextPreserveRule | null): string {
  return rule === null
    ? text
    : split_text_lines(text)
        .map((line) => rule.replace(line, ""))
        .join("\n");
}

/** 按原行号收集非空保护片段，供源文与译文做精确对照。 */
function collect_non_blank_segments_by_line(
  text: string,
  rule: TextPreserveRule | null,
): ProofreadingPreservedSegment[] {
  if (rule === null) return [];
  return split_text_lines(text).flatMap((line, line_index) =>
    collect_non_blank_text_preserve_segments(line, rule).map((value) => ({ line_index, value })),
  );
}
