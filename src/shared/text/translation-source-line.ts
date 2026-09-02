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

type PreparedTranslationSourceLineBase = {
  line_index: number;
  raw_text: string;
  prepared_text: string;
  leading_whitespace: string;
  trailing_whitespace: string;
  prefix_segments: string[];
  suffix_segments: string[];
  samples: string[];
};

export type PreparedTranslationSourceLine = PreparedTranslationSourceLineBase &
  (
    | { state: "preserved"; restoration_text: null; model_text: null }
    | { state: "translatable"; restoration_text: string; model_text: string }
  );

/** 按翻译入口的既定顺序准备单行，并同时生成校对使用的源文投影。 */
export function prepare_translation_source_line(args: {
  line_index: number;
  raw_text: string;
  text_type: string;
  config: Pick<TextProcessingConfig, "clean_ruby" | "auto_process_prefix_suffix_preserved_text">;
  preserve_rule: TextPreserveRule | null;
  pre_replacements: CompiledTextReplacements | null;
  reference_mappings?: readonly TextResourceReferenceMapping[];
}): PreparedTranslationSourceLine {
  /** 完全保护的行仍提供非空保护样例，但不会建立译后恢复状态。 */
  const preserved = (): PreparedTranslationSourceLine => {
    const samples =
      args.preserve_rule === null
        ? []
        : collect_non_blank_text_preserve_segments(args.raw_text, args.preserve_rule);
    return {
      line_index: args.line_index,
      raw_text: args.raw_text,
      state: "preserved",
      restoration_text: null,
      model_text: null,
      prepared_text: args.raw_text,
      leading_whitespace: "",
      trailing_whitespace: "",
      prefix_segments: [],
      suffix_segments: [],
      samples,
    };
  };

  const text_type = args.text_type.toUpperCase();
  const reference_mappings = args.reference_mappings ?? [];
  let text = args.config.clean_ruby
    ? transform_projected_text_resource_references(args.raw_text, reference_mappings, (value) =>
        TextRubyCleaner.clean(value, text_type),
      )
    : args.raw_text;
  if (text === "" || text.trim() === "") return preserved();

  const leading_whitespace = text.match(/^\s*/u)?.[0] ?? "";
  const trailing_whitespace = text.match(/\s*$/u)?.[0] ?? "";
  text = text.slice(leading_whitespace.length, text.length - trailing_whitespace.length);

  let prefix_segments: string[] = [];
  let suffix_segments: string[] = [];
  if (args.config.auto_process_prefix_suffix_preserved_text && args.preserve_rule !== null) {
    const prefix = args.preserve_rule.extract_prefix(text);
    text = prefix.text;
    prefix_segments = prefix.segments;
    const suffix = args.preserve_rule.extract_suffix(text);
    text = suffix.text;
    suffix_segments = suffix.segments;
  }
  if (text === "") return preserved();
  if (
    !args.config.auto_process_prefix_suffix_preserved_text &&
    (args.preserve_rule?.matches_entire_text(text) ?? false)
  ) {
    return preserved();
  }

  const pre_replacements = args.pre_replacements;
  const model_text =
    pre_replacements === null
      ? text
      : transform_projected_text_resource_references(text, reference_mappings, (value) =>
          apply_text_replacements(value, pre_replacements),
        );
  const prepared_text = `${leading_whitespace}${prefix_segments.join("")}${model_text}${suffix_segments.join("")}${trailing_whitespace}`;
  const samples =
    args.preserve_rule === null
      ? []
      : collect_non_blank_text_preserve_segments(prepared_text, args.preserve_rule);
  if (text_type === "MD") samples.push("Markdown Code");
  return {
    line_index: args.line_index,
    raw_text: args.raw_text,
    state: "translatable",
    restoration_text: text,
    model_text,
    prepared_text,
    leading_whitespace,
    trailing_whitespace,
    prefix_segments,
    suffix_segments,
    samples,
  };
}
