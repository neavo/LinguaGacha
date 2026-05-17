import type { TextQualitySnapshot } from "./text-types";
import { compile_text_pattern, replace_text_pattern } from "./text-pattern";

/**
 * 应用文本替换规则，普通模式写入字面量，正则模式使用规则型反斜杠捕获语法
 */
export function apply_text_replacements(
  text: string,
  entries: TextQualitySnapshot["pre_replacement_entries"],
): string {
  let result = text;
  for (const entry of entries) {
    const pattern_text = String(entry["src"] ?? "");
    if (pattern_text === "") {
      continue;
    }
    const replacement_text = String(entry["dst"] ?? "");
    const is_regex = entry["regex"] === true;
    const is_case_sensitive = entry["case_sensitive"] === true;

    const pattern = compile_text_pattern({
      source_text: pattern_text,
      mode: is_regex ? "regex" : "literal",
      case_sensitive: is_case_sensitive,
      global: true,
      trim: false,
    });
    if (pattern === null) {
      continue;
    }

    result = replace_text_pattern({
      text: result,
      pattern,
      replacement_text,
      replacement_syntax: is_regex ? "backslash" : "literal",
    }).text;
  }
  return result;
}
