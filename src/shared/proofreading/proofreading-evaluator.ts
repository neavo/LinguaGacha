import {
  QualityRule,
  type GlossaryEntry,
  type TextPreserveEntry,
  type TextReplacementEntry,
} from "../../domain/quality";
import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import type {
  ProofreadingClientItem,
  ProofreadingItemRecord,
  ProofreadingWarningFragmentsByCode,
} from "./proofreading-types";
import { create_proofreading_client_item } from "./list";
import {
  build_text_preserve_rule,
  collect_non_blank_text_preserve_segments,
  type TextPreserveRule,
} from "../text/text-preserve-rules";
import {
  apply_text_replacements,
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../text/text-replacement-rules";
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
  ) as GlossaryEntry[];
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
  quality_context: ProofreadingEvaluationContext;
  quality: QualitySnapshot;
  sourceLanguage: string;
  targetLanguage: string;
  sample_rule_cache: Map<string, TextPreserveRule | null>;
}): ProofreadingClientItem {
  const warnings: string[] = [];
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
    const src_replaced = apply_pre_replacements_by_line(
      args.item.src,
      args.quality_context.pre_replacements,
    );
    const normalized_dst = strip_preserved_segments(args.item.dst, sample_rule);
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

    const source_preserved_segments = collect_non_blank_segments(src_replaced, sample_rule);
    const translation_preserved_segments = collect_non_blank_segments(args.item.dst, sample_rule);
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
        src: strip_preserved_segments(src_replaced, sample_rule),
        dst: strip_preserved_segments(args.item.dst, sample_rule),
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
      })
    ) {
      warnings.push("SIMILARITY");
    }
  }

  if (args.quality_context.glossary.entries.length > 0) {
    glossary_applications = evaluate_glossary_applications(
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

/** 译前替换遵循翻译入口的逐行语义；校对不逆向猜测译后规则。 */
function apply_pre_replacements_by_line(
  text: string,
  replacements: CompiledTextReplacements | null,
): string {
  return replacements === null
    ? text
    : text
        .split("\n")
        .map((line) => apply_text_replacements(line, replacements))
        .join("\n");
}

function strip_preserved_segments(text: string, rule: TextPreserveRule | null): string {
  return rule?.replace(text, "") ?? text;
}

function collect_non_blank_segments(text: string, rule: TextPreserveRule | null): string[] {
  return rule === null ? [] : collect_non_blank_text_preserve_segments(text, rule);
}
