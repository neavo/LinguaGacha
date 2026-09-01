import {
  is_cjk_language_code,
  type ConfiguredSourceLanguageCode,
  type TargetLanguageCode,
} from "../../../../domain/language";
import type { TextPreserveRule } from "../../../../shared/text/text-preserve-rules";

const ESCAPE_RUN_PATTERN = /\\+/gu;
const NUMBER_TOKEN_PATTERN = /\d+|[①-⑳㉑-㉟㊱-㊿]/gu;

const CIRCLED_NUMBER_BY_VALUE = [
  "",
  ...Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x2460 + index)),
  ...Array.from({ length: 15 }, (_, index) => String.fromCodePoint(0x3251 + index)),
  ...Array.from({ length: 15 }, (_, index) => String.fromCodePoint(0x32b1 + index)),
];
const CIRCLED_NUMBER_VALUE_BY_TOKEN = new Map(
  CIRCLED_NUMBER_BY_VALUE.slice(1).map((token, index) => [token, String(index + 1)] as const),
);

type PunctuationFormRule = readonly [source: string, alternatives: readonly string[]];

// 结构符号和源文 CJK 形式在所有翻译方向都保持，避免模型擅自改写工程文本形态。
const STABLE_SOURCE_FORM_RULES: readonly PunctuationFormRule[] = [
  ["　", [" "]],
  ["：", [":"]],
  ["・", ["·"]],
  ["？", ["?"]],
  ["！", ["!"]],
  ["\u2014", ["\u002d", "\u2015"]],
  ["\u2015", ["\u002d", "\u2014"]],
  ["<", ["＜", "《"]],
  [">", ["＞", "》"]],
  ["＜", ["<", "《"]],
  ["＞", [">", "》"]],
  ["[", ["【"]],
  ["]", ["】"]],
  ["【", ["["]],
  ["】", ["]"]],
  ["(", ["（"]],
  [")", ["）"]],
  ["（", ["("]],
  ["）", [")"]],
  ["「", ["‘", "“", "『"]],
  ["」", ["’", "”", "』"]],
  ["『", ["‘", "“", "「"]],
  ["』", ["’", "”", "」"]],
  ["‘", ["“", "「", "『"]],
  ["’", ["”", "」", "』"]],
  ["“", ["‘", "「", "『"]],
  ["”", ["’", "」", "』"]],
];

// 非 CJK 原文翻译到 CJK 时允许模型采用目标排版，其余方向恢复这些 ASCII 形式。
const ADAPTABLE_ASCII_FORM_RULES: readonly PunctuationFormRule[] = [
  [" ", ["　"]],
  [":", ["："]],
  ["·", ["・"]],
  ["?", ["？"]],
  ["!", ["！"]],
  ["\u002d", ["\u2014", "\u2015"]],
];

/**
 * 按同一行的显式源文投影恢复模型输出；每一步只在证据能够完整对应时改写。
 */
export function restore_translation_line(args: {
  restoration_text: string;
  model_text: string;
  translation: string;
  preserve_rule: TextPreserveRule | null;
  source_language: ConfiguredSourceLanguageCode;
  target_language: TargetLanguageCode;
}): string {
  let result = remove_extra_preserved_segments(
    args.model_text,
    args.translation,
    args.preserve_rule,
  );
  result = restore_escape_run_lengths(args.restoration_text, result);
  result = restore_circled_number_forms(args.restoration_text, result);
  return stabilize_punctuation_forms({
    source: args.restoration_text,
    translation: result,
    preserve_rule: args.preserve_rule,
    source_language: args.source_language,
    target_language: args.target_language,
  });
}

/** 只有期望保护段按原顺序完整存在时，才删除模型额外生成的保护段。 */
function remove_extra_preserved_segments(
  expected_text: string,
  translation: string,
  rule: TextPreserveRule | null,
): string {
  if (rule === null) return translation;
  const expected_segments = collect_non_blank_preserved_segments(expected_text, rule);
  const actual_segments = collect_non_blank_preserved_segments(translation, rule);
  if (expected_segments.length >= actual_segments.length) return translation;

  const extra_indexes = find_extra_segment_indexes(expected_segments, actual_segments);
  if (extra_indexes === null) return translation;
  let segment_index = 0;
  return rule.replace(translation, (match) => {
    if (match.trim() === "") return match;
    return extra_indexes.has(segment_index++) ? "" : match;
  });
}

function collect_non_blank_preserved_segments(text: string, rule: TextPreserveRule): string[] {
  return rule.collect(text).filter((segment) => segment.trim() !== "");
}

/** 仅当期望序列完整构成实际序列的子序列时，返回可安全删除的位置。 */
function find_extra_segment_indexes(expected: string[], actual: string[]): Set<number> | null {
  const extra_indexes = new Set<number>();
  let expected_index = 0;
  actual.forEach((segment, index) => {
    if (segment === expected[expected_index]) expected_index += 1;
    else extra_indexes.add(index);
  });
  return expected_index === expected.length ? extra_indexes : null;
}

type EscapeRun = { value: string; following_character: string };

/** 反斜杠段数量和后继字符全部对应时，按出现顺序恢复每段长度。 */
function restore_escape_run_lengths(source: string, translation: string): string {
  const source_runs = collect_escape_runs(source);
  const translation_runs = collect_escape_runs(translation);
  if (
    source_runs.length === 0 ||
    source_runs.length !== translation_runs.length ||
    source_runs.some(
      (run, index) => run.following_character !== translation_runs[index]?.following_character,
    )
  ) {
    return translation;
  }
  if (source_runs.every((run, index) => run.value === translation_runs[index]?.value)) {
    return translation;
  }
  let index = 0;
  return translation.replace(ESCAPE_RUN_PATTERN, () => source_runs[index++]?.value ?? "");
}

/** 后继字符用于确认反斜杠段仍对应同一个控制结构，而非仅仅数量相同。 */
function collect_escape_runs(text: string): EscapeRun[] {
  return [...text.matchAll(ESCAPE_RUN_PATTERN)].map((match) => {
    const value = match[0] ?? "";
    const following_text = text.slice((match.index ?? 0) + value.length);
    return { value, following_character: Array.from(following_text)[0] ?? "" };
  });
}

/** 全部数字值和形式边界都可解释时，一次性恢复源文圆圈数字。 */
function restore_circled_number_forms(source: string, translation: string): string {
  const source_tokens = source.match(NUMBER_TOKEN_PATTERN) ?? [];
  const translation_tokens = translation.match(NUMBER_TOKEN_PATTERN) ?? [];
  if (
    !source_tokens.some((token) => CIRCLED_NUMBER_VALUE_BY_TOKEN.has(token)) ||
    source_tokens.length !== translation_tokens.length ||
    source_tokens.some(
      (token, index) => number_token_value(token) !== number_token_value(translation_tokens[index]),
    ) ||
    source_tokens.some(
      (token, index) =>
        !CIRCLED_NUMBER_VALUE_BY_TOKEN.has(token) &&
        CIRCLED_NUMBER_VALUE_BY_TOKEN.has(translation_tokens[index] ?? ""),
    )
  ) {
    return translation;
  }

  let index = 0;
  return translation.replace(NUMBER_TOKEN_PATTERN, (translation_token) => {
    const source_token = source_tokens[index++] ?? "";
    return CIRCLED_NUMBER_VALUE_BY_TOKEN.has(source_token) ? source_token : translation_token;
  });
}

function number_token_value(token: string | undefined): string | null {
  if (token === undefined) return null;
  const circled_value = CIRCLED_NUMBER_VALUE_BY_TOKEN.get(token);
  if (circled_value !== undefined) return circled_value;
  return /^\d+$/u.test(token) ? token.replace(/^0+(?=\d)/u, "") : null;
}

/** 标点先恢复源文稳定形态，再按语言方向处理可适配形态与 CJK 引号。 */
function stabilize_punctuation_forms(args: {
  source: string;
  translation: string;
  preserve_rule: TextPreserveRule | null;
  source_language: ConfiguredSourceLanguageCode;
  target_language: TargetLanguageCode;
}): string {
  let result = restore_boundary_quotes(
    args.source,
    args.translation,
    args.target_language,
    args.preserve_rule,
  );
  result = restore_source_punctuation_forms(
    args.source,
    result,
    STABLE_SOURCE_FORM_RULES,
    args.preserve_rule,
  );
  if (
    !(is_cjk_language_code(args.target_language) && !is_cjk_language_code(args.source_language))
  ) {
    result = restore_source_punctuation_forms(
      args.source,
      result,
      ADAPTABLE_ASCII_FORM_RULES,
      args.preserve_rule,
    );
  }
  return is_cjk_language_code(args.target_language)
    ? transform_unpreserved(result, args.preserve_rule, (text) =>
        text.replaceAll("“", "「").replaceAll("”", "」"),
      )
    : result;
}

/** 每条规则都基于去除保护段后的总量证据执行，保护段本身保持原样。 */
function restore_source_punctuation_forms(
  source: string,
  translation: string,
  rules: readonly PunctuationFormRule[],
  preserve_rule: TextPreserveRule | null,
): string {
  const visible_source = remove_preserved_segments(source, preserve_rule);
  let result = translation;
  for (const [source_form, alternatives] of rules) {
    const visible_translation = remove_preserved_segments(result, preserve_rule);
    if (
      !can_restore_by_total_count(visible_source, visible_translation, source_form, alternatives)
    ) {
      continue;
    }
    result = transform_unpreserved(result, preserve_rule, (text) =>
      alternatives.reduce(
        (current, alternative) => current.replaceAll(alternative, source_form),
        text,
      ),
    );
  }
  return result;
}

/** 总量能够唯一解释模型使用的等价形式时，才授权全局恢复该符号。 */
function can_restore_by_total_count(
  source: string,
  translation: string,
  source_form: string,
  alternatives: readonly string[],
): boolean {
  const source_count = count_token(source, source_form);
  const source_alternative_count = alternatives.reduce(
    (total, alternative) => total + count_token(source, alternative),
    0,
  );
  const translation_count = count_token(translation, source_form);
  const translation_alternative_count = alternatives.reduce(
    (total, alternative) => total + count_token(translation, alternative),
    0,
  );
  return (
    source_count > 0 &&
    source_count !== source_alternative_count &&
    source_count > translation_count &&
    source_count === translation_count + translation_alternative_count
  );
}

function restore_boundary_quotes(
  source: string,
  translation: string,
  target_language: TargetLanguageCode,
  preserve_rule: TextPreserveRule | null,
): string {
  const visible_source = remove_preserved_segments(source, preserve_rule).trim();
  const opening = resolve_opening_quote(visible_source, target_language);
  const closing = resolve_closing_quote(visible_source, target_language);
  if (opening === null && closing === null) return translation;
  return transform_unpreserved_boundaries(translation, preserve_rule, opening, closing);
}

function resolve_opening_quote(source: string, target_language: TargetLanguageCode): string | null {
  const quote = Array.from(source)[0] ?? "";
  if (quote === "「" || quote === "『") return quote;
  if (!is_cjk_language_code(target_language)) return null;
  if (quote === "“") return "「";
  return quote === "‘" ? quote : null;
}

function resolve_closing_quote(source: string, target_language: TargetLanguageCode): string | null {
  const quote = Array.from(source).at(-1) ?? "";
  if (quote === "」" || quote === "』") return quote;
  if (!is_cjk_language_code(target_language)) return null;
  if (quote === "”") return "」";
  return quote === "’" ? quote : null;
}

function transform_unpreserved_boundaries(
  text: string,
  rule: TextPreserveRule | null,
  opening: string | null,
  closing: string | null,
): string {
  if (rule === null) return replace_boundary_quotes(text, opening, closing);
  const chunks: string[] = [];
  rule.transform_unpreserved(text, (chunk) => {
    chunks.push(chunk);
    return chunk;
  });
  const first_index = chunks.findIndex((chunk) => chunk.trim() !== "");
  const last_index = chunks.findLastIndex((chunk) => chunk.trim() !== "");
  let index = 0;
  return rule.transform_unpreserved(text, (chunk) => {
    const current_index = index++;
    return replace_boundary_quotes(
      chunk,
      current_index === first_index ? opening : null,
      current_index === last_index ? closing : null,
    );
  });
}

function replace_boundary_quotes(
  text: string,
  opening: string | null,
  closing: string | null,
): string {
  let result = text;
  if (opening !== null) {
    result = result.replace(/^(\s*)['"‘“「『]/u, (_match, whitespace: string) => {
      return `${whitespace}${opening}`;
    });
  }
  if (closing !== null) {
    result = result.replace(/['"’”」』](\s*)$/u, (_match, whitespace: string) => {
      return `${closing}${whitespace}`;
    });
  }
  return result;
}

function transform_unpreserved(
  text: string,
  rule: TextPreserveRule | null,
  transform: (value: string) => string,
): string {
  return rule === null ? transform(text) : rule.transform_unpreserved(text, transform);
}

function remove_preserved_segments(text: string, rule: TextPreserveRule | null): string {
  return rule === null ? text : rule.replace(text, "");
}

function count_token(text: string, token: string): number {
  return token === "" ? 0 : text.split(token).length - 1;
}
