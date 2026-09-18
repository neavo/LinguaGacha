import {
  normalize_text_preserve_mode,
  type TextPreserveEntry,
  type TextPreserveMode,
} from "../../domain/quality";
import base_text_preserve_entries from "../../../builtin/text_preserve/preset/base.json";
import kag_text_preserve_entries from "../../../builtin/text_preserve/preset/kag.json";
import renpy_text_preserve_entries from "../../../builtin/text_preserve/preset/renpy.json";
import rpgmaker_text_preserve_entries from "../../../builtin/text_preserve/preset/rpgmaker.json";
import wolf_text_preserve_entries from "../../../builtin/text_preserve/preset/wolf.json";

export { normalize_text_preserve_mode };
export type { TextPreserveMode };

type TextPreserveMatch = {
  value: string;
  index: number;
  definition_index: number;
};

/** 同一文本的一次保护段裁决，同时供准备、正文剥离和保护段比较消费。 */
export type TextPreserveAnalysis = {
  text: string; // 绑定被分析的文本，处理阶段改变后据此重新分析。
  segments: readonly string[];
  unpreserved_text: string;
};

// 翻译与校对按 `text_type` 选择同一份预设条目。
const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: [],
  MD: [],
  KAG: kag_text_preserve_entries,
  RENPY: renpy_text_preserve_entries,
  RPGMAKER: rpgmaker_text_preserve_entries,
  WOLF: wolf_text_preserve_entries,
} as const;

/** 文本保护规则按源位置和规则顺序裁决正则候选，统一提供提取与替换操作。 */
export class TextPreserveRule {
  private readonly patterns: RegExp[];

  /** 一次编译本轮规则，后续文本操作复用同一组正则。 */
  public constructor(entries: readonly Pick<TextPreserveEntry, "src">[]) {
    this.patterns = entries.map(({ src }) => new RegExp(src, "giu"));
  }

  /** 一次裁决同时提供保护段与剩余正文，后续检查复用相同结果。 */
  public analyze(text: string): TextPreserveAnalysis {
    const matches = this.collect_sample_matches(text);
    return {
      text,
      segments: matches.map((match) => match.value),
      unpreserved_text: this.replace_matches(text, matches, ""),
    };
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

  /** 收集全部候选后统一裁决重叠，避免规则遍历顺序改变文本顺序。 */
  private collect_sample_matches(text: string): TextPreserveMatch[] {
    const candidates: TextPreserveMatch[] = [];
    this.patterns.forEach((pattern, definition_index) => {
      // `matchAll` 使用正则副本，每次调用从头匹配。
      for (const match of text.matchAll(pattern)) {
        const value = match[0] ?? "";
        const index = match.index ?? -1;
        if (value === "" || index < 0) {
          continue;
        }
        candidates.push({ value, index, definition_index });
      }
    });
    return this.remove_overlapping_matches(candidates);
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

  /** 按已裁决的非重叠区间替换文本。 */
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

/** 根据模式选择智能预设或项目自定义附加规则。 */
function resolve_text_preserve_entries(args: {
  mode: string;
  text_type: string;
  entries: readonly TextPreserveEntry[];
}): readonly TextPreserveEntry[] {
  const mode = normalize_text_preserve_mode(args.mode);
  if (mode === "off") {
    return [];
  }
  if (mode === "custom") {
    return args.entries;
  }
  const text_type = args.text_type.toUpperCase();
  const key = (
    text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE ? text_type : "NONE"
  ) as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE;
  return TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[key];
}

/** 构造由基础层和当前模式附加层组成的保护规则。 */
export function build_text_preserve_rule(args: {
  mode: string;
  text_type: string;
  entries: readonly TextPreserveEntry[];
}): TextPreserveRule {
  return new TextPreserveRule([
    ...base_text_preserve_entries,
    ...resolve_text_preserve_entries(args),
  ]);
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
