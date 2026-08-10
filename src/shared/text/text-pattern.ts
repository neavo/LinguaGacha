import {
  compile_literal_patterns,
  normalize_literal_text,
  type LiteralMatcher,
  type TextRange,
} from "./literal-matcher";

// 文本模式只区分用户输入的普通文本和显式正则，避免调用点自造第三种解释
type TextPatternMode = "literal" | "regex";

// 替换语法必须由业务场景声明，防止 `$1` 和 `\1` 在不同入口互相误伤
export type TextReplacementSyntax = "literal" | "javascript" | "backslash";

export type CompiledTextPattern =
  | {
      readonly kind: "literal";
      readonly matcher: LiteralMatcher;
      readonly global: boolean;
    }
  | {
      readonly kind: "regex";
      readonly regexp: RegExp;
    };

type TextPatternCompileOptions = {
  readonly source_text: string; // 用户输入或规则 src
  readonly mode: TextPatternMode; // 普通文本或正则
  readonly case_sensitive?: boolean; // 默认大小写不敏感
  readonly global?: boolean; // 默认只匹配首个命中
  readonly trim?: boolean; // 默认裁剪 UI 搜索关键字；规则入口传 false
  readonly unicode?: boolean; // 默认启用 u flag；少数旧筛选入口可关闭
};

type TextPatternCompileResult = {
  readonly pattern: CompiledTextPattern | null; // 空关键字或非法正则时为空
  readonly invalid_regex_message: string | null; // 只在正则编译失败时写入
};

export type TextKeywordMatcher = {
  readonly invalid_regex_message: string | null; // 页面直接展示的正则错误
  readonly matches: (value: string) => boolean; // 对单个候选文本执行匹配
};

export type TextKeywordsMatcher = {
  readonly keywords: readonly string[]; // 按匹配语义去重后的首次输入文本
  readonly invalid_regex: { index: number; message: string } | null; // 首个非法正则及其输入位置
  readonly match: (value: string) => string[]; // 按 keywords 顺序返回当前文本的命中归因
  readonly matches: (value: string) => boolean; // 是否至少命中一个关键词
};

/**
 * 编译可复用文本模式；空白关键字归一为 null，非法正则沿用 RegExp 原生错误
 */
export function compile_text_pattern(
  options: TextPatternCompileOptions,
): CompiledTextPattern | null {
  const source_text = normalize_text_pattern_source(options.source_text, options.trim);
  if (source_text === "") {
    return null;
  }

  const case_sensitive = options.case_sensitive === true;
  const global = options.global === true;
  if (options.mode === "literal") {
    return {
      kind: "literal",
      matcher: compile_literal_patterns([{ key: "pattern", text: source_text, case_sensitive }]),
      global,
    };
  }
  return {
    kind: "regex",
    regexp: new RegExp(
      source_text,
      build_text_pattern_flags({ case_sensitive, global, unicode: options.unicode !== false }),
    ),
  };
}

/**
 * 页面筛选使用宽返回值承接非法正则，避免 UI 层重复写 try/catch
 */
function try_compile_text_pattern(options: TextPatternCompileOptions): TextPatternCompileResult {
  try {
    return {
      pattern: compile_text_pattern(options),
      invalid_regex_message: null,
    };
  } catch (error) {
    return {
      pattern: null,
      invalid_regex_message: error instanceof Error ? error.message : "Invalid regular expression",
    };
  }
}

/**
 * 构造质量规则页通用关键字匹配器；正则失败时公开错误，普通模式始终按字面量包含匹配
 */
export function create_text_keyword_matcher(args: {
  readonly keyword: string;
  readonly is_regex: boolean;
  readonly case_sensitive?: boolean;
  readonly unicode?: boolean;
}): TextKeywordMatcher {
  const matcher = create_text_keywords_matcher({
    keywords: [args.keyword],
    is_regex: args.is_regex,
    case_sensitive: args.case_sensitive,
    unicode: args.unicode,
  });
  return {
    invalid_regex_message: matcher.invalid_regex?.message ?? null,
    matches: matcher.matches,
  };
}

/** 多关键字搜索统一预编译；字面量共用 Aho–Corasick，正则逐项编译后做 OR。 */
export function create_text_keywords_matcher(args: {
  readonly keywords: readonly string[];
  readonly is_regex: boolean;
  readonly case_sensitive?: boolean;
  readonly unicode?: boolean;
}): TextKeywordsMatcher {
  const keywords = normalize_text_keywords(args).map((keyword) => ({
    raw: keyword,
    normalized: normalize_text_pattern_source(keyword, true),
  }));
  const public_keywords = keywords.map((keyword) => keyword.raw);
  if (keywords.length === 0) {
    return { keywords: public_keywords, invalid_regex: null, match: () => [], matches: () => true };
  }

  if (!args.is_regex) {
    const matcher = compile_literal_patterns(
      keywords.map((keyword, index) => ({
        key: index.toString(),
        text: keyword.normalized,
        case_sensitive: args.case_sensitive === true,
      })),
    );
    const match = (value: string): string[] => {
      const matched_indexes = new Set<number>();
      matcher.scan(value, (key) => matched_indexes.add(Number.parseInt(key, 10)));
      return [...matched_indexes]
        .toSorted((left, right) => left - right)
        .flatMap((index) => {
          const keyword = keywords[index];
          return keyword === undefined ? [] : [keyword.raw];
        });
    };
    return {
      keywords: public_keywords,
      invalid_regex: null,
      match,
      matches: (value) => match(value).length > 0,
    };
  }

  const patterns: CompiledTextPattern[] = [];
  for (const [index, keyword] of keywords.entries()) {
    const result = try_compile_text_pattern({
      source_text: keyword.raw,
      mode: "regex",
      case_sensitive: args.case_sensitive === true,
      global: false,
      trim: false,
      unicode: args.unicode !== false,
    });
    if (result.invalid_regex_message !== null) {
      return {
        keywords: public_keywords,
        invalid_regex: { index, message: result.invalid_regex_message },
        match: () => [],
        matches: () => false,
      };
    }
    if (result.pattern !== null) patterns.push(result.pattern);
  }
  const match = (value: string): string[] =>
    patterns.flatMap((pattern, index) =>
      matches_text_pattern(value, pattern) ? [keywords[index]?.raw ?? ""] : [],
    );
  return {
    keywords: public_keywords,
    invalid_regex: null,
    match,
    matches: (value) => match(value).length > 0,
  };
}

/** 查询关键字按匹配语义形成有序集合，重复值保留首次提交的代表文本。 */
export function normalize_text_keywords(args: {
  readonly keywords: readonly string[];
  readonly is_regex: boolean;
  readonly case_sensitive?: boolean;
}): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const keyword of args.keywords) {
    const trimmed = normalize_text_pattern_source(keyword, true);
    if (trimmed === "") continue;
    const key = args.is_regex
      ? keyword
      : normalize_literal_text(trimmed, args.case_sensitive === true);
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(keyword);
  }
  return keywords;
}

/**
 * 用独立 RegExp 实例执行匹配，隔离 global / sticky lastIndex 对复用模式的影响
 */
export function matches_text_pattern(text: string, pattern: CompiledTextPattern): boolean {
  return pattern.kind === "literal"
    ? pattern.matcher.match(text).length > 0
    : clone_text_pattern_regexp(pattern).test(text);
}

/**
 * 执行文本替换并返回命中次数；替换语法由调用场景显式声明
 */
export function replace_text_pattern(args: {
  readonly text: string;
  readonly pattern: CompiledTextPattern;
  readonly replacement_text: string;
  readonly replacement_syntax: TextReplacementSyntax;
}): { text: string; count: number } {
  if (args.pattern.kind === "literal") {
    if (args.replacement_syntax !== "literal") {
      throw new Error("Literal mode only supports literal replacement syntax.");
    }
    const ranges = select_literal_replacement_ranges(args.text, args.pattern);
    return {
      text: replace_literal_ranges(args.text, ranges, args.replacement_text),
      count: ranges.length,
    };
  }

  if (args.replacement_syntax === "javascript") {
    const count = count_text_pattern_matches(args.text, args.pattern);
    return {
      text:
        count === 0
          ? args.text
          : args.text.replace(clone_text_pattern_regexp(args.pattern), args.replacement_text),
      count,
    };
  }

  const regexp = clone_text_pattern_regexp(args.pattern);
  let count = 0;
  const text = args.text.replace(regexp, (...replace_args: unknown[]) => {
    count += 1;
    if (args.replacement_syntax === "backslash") {
      return build_backslash_replacement(args.replacement_text, replace_args);
    }
    return args.replacement_text;
  });
  return {
    text,
    count,
  };
}

/**
 * 归一搜索源文本，调用点用 trim=false 保留质量规则的原始 src 语义
 */
function normalize_text_pattern_source(source_text: string, trim: boolean | undefined): string {
  return trim === false ? source_text : source_text.trim();
}

/**
 * 正则 flag 只由模式选项生成，防止调用点拼出互斥或重复 flag
 */
function build_text_pattern_flags(args: {
  readonly case_sensitive: boolean;
  readonly global: boolean;
  readonly unicode: boolean;
}): string {
  return `${args.global ? "g" : ""}${args.case_sensitive ? "" : "i"}${args.unicode ? "u" : ""}`;
}

/**
 * 每次执行都复制 RegExp，保证全局匹配和多次 test 不共享 lastIndex
 */
function clone_text_pattern_regexp(pattern: CompiledTextPattern): RegExp {
  if (pattern.kind !== "regex") {
    throw new Error("Literal mode does not have a RegExp instance.");
  }
  return new RegExp(pattern.regexp);
}

/**
 * 计数与 JS replacement string 分两步执行，既保留 `$1` 语义也拿得到替换次数
 */
function count_text_pattern_matches(text: string, pattern: CompiledTextPattern): number {
  const regexp = clone_text_pattern_regexp(pattern);
  if (!regexp.global) {
    return regexp.test(text) ? 1 : 0;
  }

  return Array.from(text.matchAll(regexp)).length;
}

function select_literal_replacement_ranges(
  text: string,
  pattern: Extract<CompiledTextPattern, { kind: "literal" }>,
): TextRange[] {
  const ranges = (pattern.matcher.match(text)[0]?.ranges ?? []).toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const selected: TextRange[] = [];
  for (const range of ranges) {
    const previous = selected.at(-1);
    if (previous !== undefined && range.start < previous.end) continue;
    selected.push(range);
    if (!pattern.global) break;
  }
  return selected;
}

function replace_literal_ranges(text: string, ranges: TextRange[], replacement: string): string {
  let result = "";
  let offset = 0;
  for (const range of ranges) {
    result += text.slice(offset, range.start) + replacement;
    offset = range.end;
  }
  return result + text.slice(offset);
}

/**
 * 规则型正则替换使用反斜杠语法，避免 `$1` 这类普通文本被误解释
 */
function build_backslash_replacement(replacement_text: string, replace_args: unknown[]): string {
  const groups = replace_args.at(-1);
  const has_named_groups = typeof groups === "object" && groups !== null;
  const captures = replace_args.slice(1, has_named_groups ? -3 : -2);
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
        return resolve_backslash_named_capture(named, captures, groups, has_named_groups);
      }

      const capture_index = Number.parseInt(String(index), 10);
      return String(captures[capture_index - 1] ?? "");
    },
  );
}

/**
 * 命名捕获和数字捕获共用 \g<...>，这里集中处理缺失值归空串
 */
function resolve_backslash_named_capture(
  named: string,
  captures: unknown[],
  groups: unknown,
  has_named_groups: boolean,
): string {
  const numeric_index = Number.parseInt(named, 10);
  if (Number.isFinite(numeric_index)) {
    return String(captures[numeric_index - 1] ?? "");
  }
  if (has_named_groups && named in (groups as Record<string, unknown>)) {
    return String((groups as Record<string, unknown>)[named] ?? "");
  }
  return "";
}
