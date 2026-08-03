import type { TextReplacementEntry } from "../../domain/quality";
import {
  compile_text_pattern,
  replace_text_pattern,
  type CompiledTextPattern,
  type TextReplacementSyntax,
} from "./text-pattern";

type CompiledTextReplacement = {
  readonly pattern: CompiledTextPattern;
  readonly replacement_text: string;
  readonly replacement_syntax: TextReplacementSyntax;
};

export type CompiledTextReplacements = readonly CompiledTextReplacement[];

/** 字面量按原文替换，正则允许反斜杠捕获组语法；所有规则按列表顺序执行。 */
export function compile_text_replacements(
  entries: readonly TextReplacementEntry[],
): CompiledTextReplacements {
  return entries.map((entry) => {
    const pattern = compile_text_pattern({
      source_text: entry.src,
      mode: entry.regex ? "regex" : "literal",
      case_sensitive: entry.case_sensitive,
      global: true,
      trim: false,
    });
    if (pattern === null) throw new TypeError("替换规则 src 不能为空");
    return {
      pattern,
      replacement_text: entry.dst,
      replacement_syntax: entry.regex ? "backslash" : "literal",
    };
  });
}

/**
 * 应用文本替换规则，普通模式写入字面量，正则模式使用规则型反斜杠捕获语法
 */
export function apply_text_replacements(text: string, compiled: CompiledTextReplacements): string {
  let result = text;
  for (const rule of compiled) {
    result = replace_text_pattern({
      text: result,
      pattern: rule.pattern,
      replacement_text: rule.replacement_text,
      replacement_syntax: rule.replacement_syntax,
    }).text;
  }
  return result;
}
