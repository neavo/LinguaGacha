import { has_cjk_language_character } from "../../domain/language";
import {
  normalize_text_preserve_mode,
  type TextPreserveEntry,
  type TextPreserveMode,
} from "../../domain/quality";

export { normalize_text_preserve_mode };
export type { TextPreserveMode };

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

  public constructor(definitions: readonly TextPreservePatternDefinition[]) {
    this.definitions = definitions.map(compile_text_preserve_pattern_definition);
  }

  /**
   * 收集正文中的可接受保护段
   */
  public collect(text: string): string[] {
    return this.collect_sample_matches(text).map((match) => match.value);
  }

  /**
   * 替换正文中的可接受保护段，回调索引只统计实际被替换的段
   */
  public replace(
    text: string,
    replacement: string | ((match: string, index: number) => string),
  ): string {
    return this.replace_matches(text, this.collect_sample_matches(text), replacement);
  }

  /** 连续提取行首保护段，并返回移除后的正文。 */
  public extract_prefix(text: string): { text: string; segments: string[] } {
    const matches = this.collect_prefix_matches(text);
    return {
      text: this.replace_matches(text, matches, ""),
      segments: matches.map((match) => match.value),
    };
  }

  /** 连续提取行尾保护段，并保持片段的原始顺序。 */
  public extract_suffix(text: string): { text: string; segments: string[] } {
    const matches = this.collect_suffix_matches(text);
    return {
      text: this.replace_matches(text, matches, ""),
      segments: matches.map((match) => match.value),
    };
  }

  /** 仅转换保护段之间的文本，保护段按原样写回。 */
  public transform_unpreserved(text: string, transform: (value: string) => string): string {
    const matches = this.collect_sample_matches(text);
    let result = "";
    let cursor = 0;
    for (const match of matches) {
      result += transform(text.slice(cursor, match.index)) + match.value;
      cursor = match.index + match.value.length;
    }
    return result + transform(text.slice(cursor));
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

  private accepts_match(value: string, definition: TextPreservePatternDefinition): boolean {
    return !definition.rejects_cjk_language_text || !has_cjk_language_character(value);
  }

  /** 同起点按规则顺序优先，随后丢弃与已选范围重叠的候选。 */
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
 * 编译规则定义为运行期可复用的匹配逻辑。
 */
function compile_text_preserve_pattern_definition(
  definition: TextPreservePatternDefinition,
): CompiledTextPreservePatternDefinition {
  return {
    ...definition,
    sample_pattern: new RegExp(definition.source, "giu"),
    prefix_pattern: new RegExp(`^(?:${definition.source})`, "iu"),
    suffix_pattern: new RegExp(`(?:${definition.source})$`, "iu"),
  };
}

function resolve_text_preserve_pattern_definitions(args: {
  mode: string;
  text_type: string;
  entries: readonly TextPreserveEntry[];
}): readonly TextPreservePatternDefinition[] {
  const mode = normalize_text_preserve_mode(args.mode);
  if (mode === "off") {
    return [];
  }
  if (mode === "custom") {
    return args.entries.map((entry) => ({
      source: entry.src,
      rejects_cjk_language_text: false,
    }));
  }
  const text_type = args.text_type.toUpperCase();
  const key = (
    text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE ? text_type : "NONE"
  ) as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE;
  return TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[key];
}

/**
 * 构造保护规则。返回 null 代表当前模式下没有任何保护规则
 */
export function build_text_preserve_rule(args: {
  mode: string;
  text_type: string;
  entries: readonly TextPreserveEntry[];
}): TextPreserveRule | null {
  const definitions = resolve_text_preserve_pattern_definitions(args);
  if (definitions.length === 0) {
    return null;
  }
  return new TextPreserveRule(definitions);
}

/**
 * 统一提取非空保护段，保留原始空白供精确比较。
 */
export function collect_non_blank_text_preserve_segments(
  text: string,
  rule: TextPreserveRule,
): string[] {
  return rule.collect(text).filter((segment) => segment.trim() !== "");
}
