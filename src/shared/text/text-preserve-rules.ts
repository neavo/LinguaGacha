import { has_cjk_language_character } from "../../domain/language";
import type { TextJsonRecord } from "./text-types";
export { normalize_text_preserve_mode, type TextPreserveMode } from "../../domain/quality";
import { normalize_text_preserve_mode } from "../../domain/quality";

export type TextPreserveRuleKind = "check" | "sample" | "prefix" | "suffix";

type TextPreservePatternDefinition = {
  source: string;
  rejects_cjk_language_text: boolean;
};

type CompiledTextPreservePatternDefinition = TextPreservePatternDefinition & {
  sample_pattern: RegExp;
  prefix_pattern: RegExp;
  suffix_pattern: RegExp;
};

type TextPreserveMatch = {
  value: string;
  index: number;
  definition_index: number;
};

// NONE 规则是所有文本类型的最小保护集合，避免 `<br>` 和空白段参与差异检查
const NONE_PATTERNS = [
  { source: "<br>", rejects_cjk_language_text: false }, // 换行符 Line break
  { source: "\\s", rejects_cjk_language_text: false }, // 空白符 Whitespace
] as const;

// Ren'Py/KAG 控制段内部若含中日韩正文，就不能当作可保护脚手架
const RENPY_LIKE_PATTERNS = [
  { source: "\\{[^\\{]*?\\}", rejects_cjk_language_text: true }, // `{=2.3}`
  { source: "\\[[^\\[]*?\\]", rejects_cjk_language_text: true }, // `[renpy.version_only]`
  ...NONE_PATTERNS,
] as const;

// RPGMaker/WOLF 共享控制码形态较多，集中在同一组规则避免校对页和任务侧漂移
const RPGMAKER_LIKE_PATTERNS = [
  { source: "<.+?:.+?>", rejects_cjk_language_text: false }, // `<sample:123>`
  { source: "en\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)", rejects_cjk_language_text: false }, // `en(!s[123])` / `en(v[123] >= 1)`
  { source: "if\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)", rejects_cjk_language_text: false }, // `if(!s[123])` / `if(v[123] >= 1)`
  {
    source: "[<【]{0,1}[/\\\\][a-z]{1,8}[<\\[][a-z\\d]{0,16}[>\\]][>】]{0,1}", // `/c[xy123]` / `\bc[xy123]` / `<\bc[xy123]>` / `【/c[xy123]】`
    rejects_cjk_language_text: false,
  },
  { source: "%\\d+", rejects_cjk_language_text: false }, // `%1` / `%2`
  { source: "@\\d+", rejects_cjk_language_text: false }, // WOLF 角色 ID
  { source: "\\\\[cus]db\\[.+?:.+?:.+?\\]", rejects_cjk_language_text: false }, // WOLF 数据库变量
  { source: "\\\\f[rbi]", rejects_cjk_language_text: false }, // 文本重置、文本加粗、文本倾斜
  { source: "\\\\[\\{\\}]", rejects_cjk_language_text: false }, // 字体放大、字体缩小
  { source: "\\\\\\$", rejects_cjk_language_text: false }, // 打开金币框
  { source: "\\\\\\.", rejects_cjk_language_text: false }, // 等待 0.25 秒
  { source: "\\\\\\|", rejects_cjk_language_text: false }, // 等待 1.00 秒
  { source: "\\\\!", rejects_cjk_language_text: false }, // 等待按钮按下
  { source: "\\\\>", rejects_cjk_language_text: false }, // 在同一行显示文字
  { source: "\\\\<", rejects_cjk_language_text: false }, // 取消显示所有文字
  { source: "\\\\\\^", rejects_cjk_language_text: false }, // 显示文本后不需要等待
  { source: "[/\\\\][a-z]{1,8}(?=<.{0,16}>|\\[.{0,16}\\])", rejects_cjk_language_text: false }, // `/C<>` / `\FS<>` / `/C[]` / `\FS[]` 中 `<>` / `[]` 前的部分
  { source: "\\\\[a-z](?=[^a-z<>\\[\\]])", rejects_cjk_language_text: false }, // 单字母转义符
  ...NONE_PATTERNS,
] as const;

// 按 text_type 映射智能保护规则，任务 worker 和校对页必须共用同一张表
const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: NONE_PATTERNS,
  MD: NONE_PATTERNS,
  KAG: RENPY_LIKE_PATTERNS,
  RENPY: RENPY_LIKE_PATTERNS,
  RPGMAKER: RPGMAKER_LIKE_PATTERNS,
  WOLF: RPGMAKER_LIKE_PATTERNS,
} as const;

/**
 * 文本保护规则用正则提取候选，再用语义谓词过滤候选，避免向下游泄漏语言正则实现
 */
export class TextPreserveRule {
  private readonly definitions: CompiledTextPreservePatternDefinition[];
  private readonly kind: TextPreserveRuleKind;

  /**
   * 初始化当前实例的内部状态。
   */
  public constructor(
    definitions: readonly TextPreservePatternDefinition[],
    kind: TextPreserveRuleKind,
  ) {
    this.definitions = definitions.flatMap(compile_text_preserve_pattern_definition);
    this.kind = kind;
  }

  /**
   * 所有规则都编译失败时等同没有可执行保护规则
   */
  public is_empty(): boolean {
    return this.definitions.length === 0;
  }

  /**
   * 判断文本是否包含当前 kind 下可接受的保护段
   */
  public test(text: string): boolean {
    return this.collect(text).length > 0;
  }

  /**
   * 收集当前 kind 下的可接受保护段，prefix/suffix 只返回对应边缘连续段
   */
  public collect(text: string): string[] {
    if (this.kind === "prefix") {
      return this.collect_prefix_matches(text).map((match) => match.value);
    }
    if (this.kind === "suffix") {
      return this.collect_suffix_matches(text).map((match) => match.value);
    }
    return this.collect_sample_matches(text).map((match) => match.value);
  }

  /**
   * 替换当前 kind 下的可接受保护段，回调索引只统计实际被替换的段
   */
  public replace(
    text: string,
    replacement: string | ((match: string, index: number) => string),
  ): string {
    const matches =
      this.kind === "prefix"
        ? this.collect_prefix_matches(text)
        : this.kind === "suffix"
          ? this.collect_suffix_matches(text)
          : this.collect_sample_matches(text);
    return this.replace_matches(text, matches, replacement);
  }

  /**
   * check 规则要求保护段连续覆盖完整文本，不能只靠任意命中判断
   */
  public matches_entire_text(text: string): boolean {
    if (text === "") {
      return false;
    }
    const matches = this.collect_sample_matches(text);
    let cursor = 0;
    for (const match of matches) {
      if (match.index !== cursor) {
        return false;
      }
      cursor += match.value.length;
    }
    return cursor === text.length;
  }

  /**
   * 读取当前场景需要的稳定数据。
   */
  private collect_sample_matches(text: string): TextPreserveMatch[] {
    const candidates: TextPreserveMatch[] = [];
    this.definitions.forEach((definition, definition_index) => {
      const pattern = definition.sample_pattern;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const value = match[0] ?? "";
        const index = match.index ?? -1;
        if (value === "" || index < 0 || !this.accepts_match(value, definition)) {
          continue;
        }
        candidates.push({ value, index, definition_index });
      }
      pattern.lastIndex = 0;
    });
    return this.remove_overlapping_matches(candidates);
  }

  /**
   * 读取当前场景需要的稳定数据。
   */
  private collect_prefix_matches(text: string): TextPreserveMatch[] {
    const matches: TextPreserveMatch[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      const match = this.find_edge_match(text.slice(cursor), "prefix");
      if (match === null) {
        break;
      }
      matches.push({ ...match, index: cursor });
      cursor += match.value.length;
    }
    return matches;
  }

  /**
   * 读取当前场景需要的稳定数据。
   */
  private collect_suffix_matches(text: string): TextPreserveMatch[] {
    const matches: TextPreserveMatch[] = [];
    let end = text.length;
    while (end > 0) {
      const match = this.find_edge_match(text.slice(0, end), "suffix");
      if (match === null) {
        break;
      }
      matches.unshift({ ...match, index: end - match.value.length });
      end -= match.value.length;
    }
    return matches;
  }

  /**
   * 读取当前场景需要的稳定数据。
   */
  private find_edge_match(text: string, edge: "prefix" | "suffix"): TextPreserveMatch | null {
    for (const [definition_index, definition] of this.definitions.entries()) {
      const pattern = edge === "prefix" ? definition.prefix_pattern : definition.suffix_pattern;
      pattern.lastIndex = 0;
      const value = pattern.exec(text)?.[0] ?? "";
      if (value === "" || !this.accepts_match(value, definition)) {
        continue;
      }
      return {
        value,
        index: edge === "prefix" ? 0 : text.length - value.length,
        definition_index,
      };
    }
    return null;
  }

  /**
   * 承接当前模块的核心控制分支。
   */
  private accepts_match(value: string, definition: TextPreservePatternDefinition): boolean {
    return !definition.rejects_cjk_language_text || !has_cjk_language_character(value);
  }

  /**
   * 清理当前场景的数据状态。
   */
  private remove_overlapping_matches(candidates: TextPreserveMatch[]): TextPreserveMatch[] {
    const sorted_candidates = [...candidates].sort((left, right) => {
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      return left.definition_index - right.definition_index;
    });
    const result: TextPreserveMatch[] = [];
    let cursor = 0;
    for (const candidate of sorted_candidates) {
      if (candidate.index < cursor) {
        continue;
      }
      result.push(candidate);
      cursor = candidate.index + candidate.value.length;
    }
    return result;
  }

  /**
   * 承接当前模块的核心控制分支。
   */
  private replace_matches(
    text: string,
    matches: TextPreserveMatch[],
    replacement: string | ((match: string, index: number) => string),
  ): string {
    let result = "";
    let cursor = 0;
    matches.forEach((match, index) => {
      result += text.slice(cursor, match.index);
      result += typeof replacement === "string" ? replacement : replacement(match.value, index);
      cursor = match.index + match.value.length;
    });
    return `${result}${text.slice(cursor)}`;
  }
}

/**
 * 把配置里常见的 \UXXXXXXXX 写法转换成 JavaScript 正则可识别格式
 */
function normalize_regex_pattern_for_javascript(pattern: string): string {
  return pattern.replace(/\\U([0-9a-fA-F]{8})/gu, (_match, hex: string) => {
    return `\\u{${hex.replace(/^0+/, "") || "0"}}`;
  });
}

/**
 * 编译规则定义为运行期可复用的匹配逻辑。
 */
function compile_text_preserve_pattern_definition(
  definition: TextPreservePatternDefinition,
): CompiledTextPreservePatternDefinition[] {
  const source = normalize_regex_pattern_for_javascript(definition.source);
  try {
    return [
      {
        ...definition,
        source,
        sample_pattern: new RegExp(source, "giu"),
        prefix_pattern: new RegExp(`^(?:${source})`, "iu"),
        suffix_pattern: new RegExp(`(?:${source})$`, "iu"),
      },
    ];
  } catch {
    return [];
  }
}

/**
 * 构造当前场景的标准初始数据。
 */
function create_custom_pattern_definitions(
  entries: TextJsonRecord[],
): TextPreservePatternDefinition[] {
  return entries
    .map((entry) => entry["src"])
    .filter((src): src is string => typeof src === "string")
    .map((src) => src.trim())
    .filter(Boolean)
    .map((source) => {
      return {
        source,
        rejects_cjk_language_text: false,
      };
    });
}

/**
 * 解析当前场景的最终消费值。
 */
function resolve_text_preserve_pattern_definitions(args: {
  mode: string;
  text_type: string;
  entries: TextJsonRecord[];
}): TextPreservePatternDefinition[] {
  const mode = normalize_text_preserve_mode(args.mode);
  if (mode === "off") {
    return [];
  }
  if (mode === "custom") {
    return create_custom_pattern_definitions(args.entries);
  }
  const text_type = args.text_type.toUpperCase();
  const key = (
    text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE ? text_type : "NONE"
  ) as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE;
  return TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[key].map((definition) => {
    return { ...definition };
  });
}

/**
 * 构造保护规则。返回 null 代表当前模式下没有任何保护规则
 */
export function build_text_preserve_rule(args: {
  mode: string;
  text_type: string;
  entries: TextJsonRecord[];
  kind: TextPreserveRuleKind;
}): TextPreserveRule | null {
  const definitions = resolve_text_preserve_pattern_definitions(args);
  if (definitions.length === 0) {
    return null;
  }
  const rule = new TextPreserveRule(definitions, args.kind);
  return rule.is_empty() ? null : rule;
}

const BLANK_PATTERN = /\s+/gu;

/**
 * 统一提取并归一化非空保护段，供响应检查和迁移对拍复用
 */
export function collect_non_blank_text_preserve_segments(
  text: string,
  rule: TextPreserveRule,
): string[] {
  return rule.collect(text).flatMap((match) => {
    const segment = match.replace(BLANK_PATTERN, "");
    if (segment !== "") {
      return [segment];
    }
    return [];
  });
}

/**
 * 按保护段序列比较源文和译文，避免保护段位置移动造成误判
 */
export function are_text_preserve_segments_equal(
  src: string,
  dst: string,
  rule: TextPreserveRule,
): boolean {
  const src_segments = collect_non_blank_text_preserve_segments(src, rule);
  const dst_segments = collect_non_blank_text_preserve_segments(dst, rule);
  return src_segments.join("\u0000") === dst_segments.join("\u0000");
}
