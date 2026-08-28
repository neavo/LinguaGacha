import { TextRubyCleaner } from "./text-ruby-cleaner";
import type { TextProcessingConfig } from "./text-types";
import type { TextPreserveRule } from "./text-preserve-rules";
import { apply_text_replacements, type CompiledTextReplacements } from "./text-replacement-rules";

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
  ({ state: "preserved"; model_text: null } | { state: "translatable"; model_text: string });

/** 按翻译入口的既定顺序准备单行，并同时生成校对使用的源文投影。 */
export function prepare_translation_source_line(args: {
  line_index: number;
  raw_text: string;
  text_type: string;
  config: Pick<TextProcessingConfig, "clean_ruby" | "auto_process_prefix_suffix_preserved_text">;
  preserve_rule: TextPreserveRule | null;
  pre_replacements: CompiledTextReplacements | null;
}): PreparedTranslationSourceLine {
  const preserved = (): PreparedTranslationSourceLine => ({
    line_index: args.line_index,
    raw_text: args.raw_text,
    state: "preserved",
    model_text: null,
    prepared_text: args.raw_text,
    leading_whitespace: "",
    trailing_whitespace: "",
    prefix_segments: [],
    suffix_segments: [],
    samples: [],
  });

  const text_type = args.text_type.toUpperCase();
  let text = args.config.clean_ruby
    ? TextRubyCleaner.clean(args.raw_text, text_type)
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

  const model_text =
    args.pre_replacements === null ? text : apply_text_replacements(text, args.pre_replacements);
  const samples = args.preserve_rule?.collect(model_text) ?? [];
  if (text_type === "MD") samples.push("Markdown Code");
  return {
    line_index: args.line_index,
    raw_text: args.raw_text,
    state: "translatable",
    model_text,
    prepared_text: `${leading_whitespace}${prefix_segments.join("")}${model_text}${suffix_segments.join("")}${trailing_whitespace}`,
    leading_whitespace,
    trailing_whitespace,
    prefix_segments,
    suffix_segments,
    samples,
  };
}
