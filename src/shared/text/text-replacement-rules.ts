import type { TextQualitySnapshot } from "./text-types";

/**
 * 应用文本替换规则，兼容普通替换和历史正则反向引用语义
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
    if (is_regex) {
      result = result.replace(
        new RegExp(pattern_text, is_case_sensitive ? "gu" : "giu"),
        (...args) => build_regex_replacement(replacement_text, args),
      );
    } else if (is_case_sensitive) {
      result = result.split(pattern_text).join(replacement_text);
    } else {
      result = result.replace(new RegExp(escape_regexp(pattern_text), "giu"), () => {
        return replacement_text;
      });
    }
  }
  return result;
}

/**
 * 正则替换兼容历史常见反向引用，同时避免 JS `$&/$1` 语义误伤字面量
 */
function build_regex_replacement(replacement_text: string, args: unknown[]): string {
  const groups = args.at(-1);
  const has_named_groups = typeof groups === "object" && groups !== null;
  const captures = args.slice(1, has_named_groups ? -3 : -2);
  return replacement_text.replace(
    /\\g<([^>]+)>|\\([1-9][0-9]?)|\\([nrt])|\\\\/gu,
    (match, named, index, escaped_char) => {
      if (match === "\\\\") {
        return "\\";
      }
      if (escaped_char === "n") {
        return "\n";
      }
      if (escaped_char === "r") {
        return "\r";
      }
      if (escaped_char === "t") {
        return "\t";
      }
      if (typeof named === "string" && named !== "") {
        const numeric_index = Number.parseInt(named, 10);
        if (Number.isFinite(numeric_index)) {
          return String(captures[numeric_index - 1] ?? "");
        }
        if (has_named_groups && named in (groups as Record<string, unknown>)) {
          return String((groups as Record<string, unknown>)[named] ?? "");
        }
        return "";
      }
      const capture_index = Number.parseInt(String(index), 10);
      return String(captures[capture_index - 1] ?? "");
    },
  );
}

/**
 * 正则转义集中处理，避免普通替换误解释特殊字符
 */
function escape_regexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
