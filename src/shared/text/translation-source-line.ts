import { TextRubyCleaner } from "./text-ruby-cleaner";
import type { TextProcessingConfig } from "./text-types";
import {
  collect_non_blank_text_preserve_segments,
  type TextPreserveRule,
} from "./text-preserve-rules";
import { apply_text_replacements, type CompiledTextReplacements } from "./text-replacement-rules";
import {
  transform_projected_text_resource_references,
  type TextResourceReferenceMapping,
} from "./text-resource-reference";

export type PreparedTranslationSourceLine = {
  prepared_text: string; // 实际请求和校对共用的完整源文，保留行直接保存原文。
  samples: string[];
} & (
  | { state: "preserved" }
  | {
      state: "translatable";
      restoration_text: string; // 译前替换之前的正文，用于恢复源文形式。
      leading_whitespace: string;
      trailing_whitespace: string;
    }
);

/** 按翻译入口的既定顺序准备单行，并同时生成校对使用的源文投影。 */
export function prepare_translation_source_line(args: {
  raw_text: string;
  text_type: string;
  config: Pick<TextProcessingConfig, "clean_ruby">;
  preserve_rule: TextPreserveRule;
  pre_replacements: CompiledTextReplacements | null;
  reference_mappings?: readonly TextResourceReferenceMapping[];
}): PreparedTranslationSourceLine {
  /** 完全保护的行仍提供非空保护样例，但不会建立译后恢复状态。 */
  const preserved = (): PreparedTranslationSourceLine => {
    return {
      state: "preserved",
      prepared_text: args.raw_text,
      samples: collect_non_blank_text_preserve_segments(args.raw_text, args.preserve_rule),
    };
  };

  const text_type = args.text_type.toUpperCase();
  const reference_mappings = args.reference_mappings ?? [];
  let text = args.config.clean_ruby
    ? transform_projected_text_resource_references(args.raw_text, reference_mappings, (value) =>
        TextRubyCleaner.clean(value, text_type),
      )
    : args.raw_text;
  if (text.trim() === "") return preserved();

  const leading_whitespace = text.match(/^\s*/u)?.[0] ?? "";
  const trailing_whitespace = text.match(/\s*$/u)?.[0] ?? "";
  text = text.slice(leading_whitespace.length, text.length - trailing_whitespace.length);

  if (args.preserve_rule.matches_entire_text(text)) {
    return preserved();
  }

  const pre_replacements = args.pre_replacements;
  const replaced_text =
    pre_replacements === null
      ? text
      : transform_projected_text_resource_references(text, reference_mappings, (value) =>
          apply_text_replacements(value, pre_replacements),
        );
  const prepared_text = `${leading_whitespace}${replaced_text}${trailing_whitespace}`;
  const samples = collect_non_blank_text_preserve_segments(prepared_text, args.preserve_rule);
  if (text_type === "MD") samples.push("Markdown Code");
  return {
    state: "translatable",
    restoration_text: text,
    prepared_text,
    leading_whitespace,
    trailing_whitespace,
    samples,
  };
}
