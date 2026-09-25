import { TextRubyCleaner } from "./text-ruby-cleaner";
import type { TextProcessingConfig } from "./text-types";
import { type TextPreserveAnalysis, type TextPreserveRule } from "./text-preserve-rules";
import { apply_text_replacements, type CompiledTextReplacements } from "./text-replacement-rules";
import {
  project_text_resource_references,
  transform_projected_text_resource_references,
  type TextResourceReferenceProjection,
  type TextResourceReferenceMapping,
} from "./text-resource-reference";

export type PreparedTranslationSourceLine = {
  prepared_text: string; // 实际请求和校对共用的完整源文，保留行直接保存原文。
  preserve_analysis: TextPreserveAnalysis; // 绑定 prepared_text；校对复用同一阶段的保护段裁决。
} & (
  | { state: "preserved" }
  | {
      state: "translatable";
      restoration_text: string; // 译前替换之前的正文，用于恢复源文形式。
      leading_whitespace: string;
      trailing_whitespace: string;
    }
);

export type PreparedTranslationSource = {
  body: TextResourceReferenceProjection; // 原始正文的资源映射，覆盖每行准备及译后恢复。
  name: TextResourceReferenceProjection | null; // 可见姓名按整段投影，不执行正文清理与替换。
  prepared_lines: PreparedTranslationSourceLine[];
  samples: string[]; // 汇总去重后的请求样例，逐行结果只保存保护分析。
};

/** 翻译与校对共用完整源文准备；资源在清理、分行和替换前隔离。 */
export function prepare_translation_source(args: {
  src: string;
  name_src: string | null;
  text_type: string;
  config: Pick<TextProcessingConfig, "clean_ruby">;
  preserve_rule: TextPreserveRule;
  pre_replacements: CompiledTextReplacements | null;
  start_ordinal: number;
}): PreparedTranslationSource {
  const name =
    args.name_src === null
      ? null
      : project_text_resource_references(args.name_src, args.start_ordinal);
  const body = project_text_resource_references(
    args.src.replace(/\r\n|\r/gu, "\n"),
    name?.next_ordinal ?? args.start_ordinal,
  );
  const prepared_lines = body.text.split("\n").map((raw_text) =>
    prepare_translation_source_line({
      raw_text,
      text_type: args.text_type,
      config: args.config,
      preserve_rule: args.preserve_rule,
      pre_replacements: args.pre_replacements,
      reference_mappings: body.mappings,
    }),
  );
  const samples = name === null ? [] : args.preserve_rule.collect(name.text);
  for (const line of prepared_lines) {
    samples.push(...line.preserve_analysis.segments);
    // 按源行顺序提供保护样例，Markdown 正文需要附带格式说明。
    if (args.text_type.toUpperCase() === "MD" && line.state === "translatable") {
      samples.push("Markdown Code");
    }
  }
  return {
    body,
    name,
    prepared_lines,
    samples: [...new Set(samples.filter((value) => value.trim() !== ""))],
  };
}

/** 按翻译入口的既定顺序准备单行，并同时生成校对使用的源文投影。 */
function prepare_translation_source_line(args: {
  raw_text: string;
  text_type: string;
  config: Pick<TextProcessingConfig, "clean_ruby">;
  preserve_rule: TextPreserveRule;
  pre_replacements: CompiledTextReplacements | null;
  reference_mappings: readonly TextResourceReferenceMapping[];
}): PreparedTranslationSourceLine {
  /** 完全保护的行仍提供非空保护样例，但不会建立译后恢复状态。 */
  const preserved = (analysis: TextPreserveAnalysis): PreparedTranslationSourceLine => {
    const preserve_analysis =
      analysis.text === args.raw_text ? analysis : args.preserve_rule.analyze(args.raw_text);
    return {
      state: "preserved",
      prepared_text: args.raw_text,
      preserve_analysis,
    };
  };

  const text_type = args.text_type.toUpperCase();
  const reference_mappings = args.reference_mappings;
  let text = args.config.clean_ruby
    ? transform_projected_text_resource_references(args.raw_text, reference_mappings, (value) =>
        TextRubyCleaner.clean(value, text_type),
      )
    : args.raw_text;
  if (text.trim() === "") return preserved(args.preserve_rule.analyze(args.raw_text));

  const leading_whitespace = text.match(/^\s*/u)?.[0] ?? "";
  const trailing_whitespace = text.match(/\s*$/u)?.[0] ?? "";
  text = text.slice(leading_whitespace.length, text.length - trailing_whitespace.length);

  const trimmed_analysis = args.preserve_rule.analyze(text);
  if (trimmed_analysis.unpreserved_text.trim() === "") {
    return preserved(trimmed_analysis);
  }

  const pre_replacements = args.pre_replacements;
  const replaced_text =
    pre_replacements === null
      ? text
      : transform_projected_text_resource_references(text, reference_mappings, (value) =>
          apply_text_replacements(value, pre_replacements),
        );
  const prepared_text = `${leading_whitespace}${replaced_text}${trailing_whitespace}`;
  const preserve_analysis =
    prepared_text === trimmed_analysis.text
      ? trimmed_analysis
      : args.preserve_rule.analyze(prepared_text);
  return {
    state: "translatable",
    restoration_text: text,
    prepared_text,
    preserve_analysis,
    leading_whitespace,
    trailing_whitespace,
  };
}
