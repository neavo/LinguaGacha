import {
  applyQualityCompiledTextParts,
  applyQualityCompiledReplacements,
  collectNonBlankQualityPreservedSegments,
  createQualityTextPreserveRule,
  partitionQualityCompiledGlossaryTerms,
  stripQualityPreservedSegments,
  type QualityCompiledContext,
} from "../quality/compiled";
import type { QualitySnapshot } from "../quality/snapshot";
import type {
  ProofreadingClientItem,
  ProofreadingGlossaryTerm,
  ProofreadingItemRecord,
  ProofreadingWarningFragmentsByCode,
} from "./proofreading-types";
import { create_proofreading_client_item } from "./list";
import type { TextPreserveRule } from "../text/text-preserve-rules";
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
function build_text_preserve_failed_fragments(args: {
  source_segments: string[];
  translation_segments: string[];
}): string[] {
  const failed_fragments: string[] = [];
  const max_length = Math.max(args.source_segments.length, args.translation_segments.length);

  for (let index = 0; index < max_length; index += 1) {
    const source_segment = args.source_segments[index];
    const translation_segment = args.translation_segments[index];
    if (source_segment === translation_segment) {
      continue;
    }

    if (source_segment !== undefined) {
      failed_fragments.push(source_segment);
    }
    if (translation_segment !== undefined) {
      failed_fragments.push(translation_segment);
    }
  }

  return [...new Set(failed_fragments)];
}

/**
 * 单条 item 的全部校对警告在这里生成，保证列表、面板和弹窗看到同一份判断。
 */
export function evaluateProofreadingItem(args: {
  item: ProofreadingItemRecord;
  quality_context: QualityCompiledContext;
  quality: QualitySnapshot;
  sourceLanguage: string;
  targetLanguage: string;
  sample_rule_cache: Map<string, TextPreserveRule | null>;
}): ProofreadingClientItem | null {
  const warnings: string[] = [];
  const warning_fragments_by_code: ProofreadingWarningFragmentsByCode = {};
  const failed_terms: ProofreadingGlossaryTerm[] = [];
  const applied_terms: ProofreadingGlossaryTerm[] = [];
  const sample_rule_cache_key = `${args.item.text_type}:${args.quality.text_preserve.mode}:${args.quality.text_preserve.revision}`;
  let sample_rule = args.sample_rule_cache.get(sample_rule_cache_key);
  if (sample_rule === undefined) {
    sample_rule = createQualityTextPreserveRule({
      mode: args.quality.text_preserve.mode,
      text_type: args.item.text_type,
      entries: args.quality.text_preserve.entries,
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
      failed_terms,
      applied_terms,
    });
  }

  if (args.item.dst !== "") {
    const { src_replaced, dst_replaced } = applyQualityCompiledReplacements(
      args.item,
      args.quality_context,
    );
    const normalized_dst = stripQualityPreservedSegments(args.item.dst, sample_rule);
    const residue_fragments = collect_translation_residue_fragments({
      text: normalized_dst,
      sourceLanguage: args.sourceLanguage,
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

    const source_preserved_segments = collectNonBlankQualityPreservedSegments(
      src_replaced,
      sample_rule,
    );
    const translation_preserved_segments = collectNonBlankQualityPreservedSegments(
      dst_replaced,
      sample_rule,
    );
    if (
      source_preserved_segments.join("\u0000") !== translation_preserved_segments.join("\u0000")
    ) {
      warnings.push("TEXT_PRESERVE");
      warning_fragments_by_code.TEXT_PRESERVE = build_text_preserve_failed_fragments({
        source_segments: source_preserved_segments,
        translation_segments: translation_preserved_segments,
      });
    }

    if (
      has_translation_similarity_issue({
        src: stripQualityPreservedSegments(src_replaced, sample_rule),
        dst: stripQualityPreservedSegments(dst_replaced, sample_rule),
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
      })
    ) {
      warnings.push("SIMILARITY");
    }
  }

  if (args.quality_context.glossary.entries.length > 0) {
    const replaced_parts = applyQualityCompiledTextParts(
      {
        source: read_item_source_text_parts(args.item),
        translation: read_item_translation_text_parts(args.item),
      },
      args.quality_context,
    );
    const glossary_result = partitionQualityCompiledGlossaryTerms({
      glossary: args.quality_context.glossary,
      source_replaced_parts: replaced_parts.source,
      translation_replaced_parts: replaced_parts.translation,
    });
    failed_terms.push(...glossary_result.failed_terms);
    applied_terms.push(...glossary_result.applied_terms);
    if (glossary_result.failed_terms.length > 0) {
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
    failed_terms,
    applied_terms,
  });
}
