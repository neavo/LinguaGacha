// 文本模式只区分用户输入的普通文本和显式正则，避免调用点自造第三种解释
export type TextPatternMode = "literal" | "regex";

// 替换语法必须由业务场景声明，防止 `$1` 和 `\1` 在不同入口互相误伤
export type TextReplacementSyntax = "literal" | "javascript" | "backslash";

export type CompiledTextPattern = {
  readonly source_text: string; // 归一后的原始模式文本，错误提示和后续判断共用
  readonly mode: TextPatternMode; // 编译来源，区分普通文本转义和正则直编译
  readonly case_sensitive: boolean; // false 时统一生成 i flag
  readonly global: boolean; // true 时用于全部替换和替换计数
  readonly regexp: RegExp; // 实际执行用正则，使用前会复制以隔离 lastIndex
};

export type TextPatternCompileOptions = {
  readonly source_text: string; // 用户输入或规则 src
  readonly mode: TextPatternMode; // 普通文本或正则
  readonly case_sensitive?: boolean; // 默认大小写不敏感
  readonly global?: boolean; // 默认只匹配首个命中
  readonly trim?: boolean; // 默认裁剪 UI 搜索关键字；规则入口传 false
  readonly unicode?: boolean; // 默认启用 u flag；少数旧筛选入口可关闭
};

export type TextPatternCompileResult = {
  readonly pattern: CompiledTextPattern | null; // 空关键字或非法正则时为空
  readonly invalid_regex_message: string | null; // 只在正则编译失败时写入
};

export type TextKeywordMatcher = {
  readonly invalid_regex_message: string | null; // 页面直接展示的正则错误
  readonly matches: (value: string) => boolean; // 对单个候选文本执行匹配
};

/**
 * 普通文本模式进入 RegExp 前统一转义，避免调用点各自维护特殊字符集合
 */
export function escape_text_pattern(source_text: string): string {
  return source_text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

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

  const mode = options.mode;
  const case_sensitive = options.case_sensitive === true;
  const global = options.global === true;
  const pattern_source = mode === "regex" ? source_text : escape_text_pattern(source_text);
  return {
    source_text,
    mode,
    case_sensitive,
    global,
    regexp: new RegExp(
      pattern_source,
      build_text_pattern_flags({ case_sensitive, global, unicode: options.unicode !== false }),
    ),
  };
}

/**
 * 页面筛选使用宽返回值承接非法正则，避免 UI 层重复写 try/catch
 */
export function try_compile_text_pattern(
  options: TextPatternCompileOptions,
): TextPatternCompileResult {
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
  const normalized_keyword = normalize_text_pattern_source(args.keyword, true);
  if (normalized_keyword === "") {
    return {
      invalid_regex_message: null,
      matches: () => true,
    };
  }

  const case_sensitive = args.case_sensitive === true;
  if (args.is_regex) {
    const compile_result = try_compile_text_pattern({
      source_text: args.keyword,
      mode: "regex",
      case_sensitive,
      global: false,
      trim: false,
      unicode: args.unicode !== false,
    });
    return {
      invalid_regex_message: compile_result.invalid_regex_message,
      matches: (value: string): boolean => {
        return compile_result.pattern === null
          ? false
          : matches_text_pattern(value, compile_result.pattern);
      },
    };
  }

  const keyword = case_sensitive ? normalized_keyword : normalized_keyword.toLocaleLowerCase();
  return {
    invalid_regex_message: null,
    matches: (value: string): boolean => {
      const candidate = case_sensitive ? value : value.toLocaleLowerCase();
      return candidate.includes(keyword);
    },
  };
}

/**
 * 用独立 RegExp 实例执行匹配，隔离 global / sticky lastIndex 对复用模式的影响
 */
export function matches_text_pattern(text: string, pattern: CompiledTextPattern): boolean {
  return clone_text_pattern_regexp(pattern).test(text);
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
  return new RegExp(pattern.regexp.source, pattern.regexp.flags);
}

/**
 * 计数与 JS replacement string 分两步执行，既保留 `$1` 语义也拿得到替换次数
 */
function count_text_pattern_matches(text: string, pattern: CompiledTextPattern): number {
  const regexp = clone_text_pattern_regexp(pattern);
  if (!pattern.global) {
    return regexp.test(text) ? 1 : 0;
  }

  return Array.from(text.matchAll(regexp)).length;
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
