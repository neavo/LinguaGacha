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

type TextPreservePatternDefinition = {
  source: string;
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

// 预设文件同时服务编辑界面与运行时，避免规则内容形成第二套代码事实。
const BASE_PATTERNS = create_text_preserve_pattern_definitions(base_text_preserve_entries);

// 按 text_type 映射智能保护规则，任务 worker 和校对页必须共用同一张表
const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: [],
  MD: [],
  KAG: create_text_preserve_pattern_definitions(kag_text_preserve_entries),
  RENPY: create_text_preserve_pattern_definitions(renpy_text_preserve_entries),
  RPGMAKER: create_text_preserve_pattern_definitions(rpgmaker_text_preserve_entries),
  WOLF: create_text_preserve_pattern_definitions(wolf_text_preserve_entries),
} as const;

/** 文本保护规则按源位置和规则顺序裁决正则候选，统一提供提取与替换操作。 */
export class TextPreserveRule {
  private readonly definitions: CompiledTextPreservePatternDefinition[];

  /** 一次编译本轮规则，后续文本操作复用同一组正则。 */
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

  /** 收集全部候选后统一裁决重叠，避免规则遍历顺序改变文本顺序。 */
  private collect_sample_matches(text: string): TextPreserveMatch[] {
    const candidates: TextPreserveMatch[] = [];
    this.definitions.forEach((definition, definition_index) => {
      const pattern = definition.sample_pattern;
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const value = match[0] ?? "";
        const index = match.index ?? -1;
        if (value === "" || index < 0) {
          continue;
        }
        candidates.push({ value, index, definition_index });
      }
      pattern.lastIndex = 0;
    });
    return this.remove_overlapping_matches(candidates);
  }

  /** 从左向右连续消费行首保护段。 */
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

  /** 从右向左连续消费行尾保护段，并恢复为原始顺序。 */
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

  /** 按规则优先级寻找当前边缘的首个非空白保护段。 */
  private find_edge_match(text: string, edge: "prefix" | "suffix"): TextPreserveMatch | null {
    for (const [definition_index, definition] of this.definitions.entries()) {
      const pattern = edge === "prefix" ? definition.prefix_pattern : definition.suffix_pattern;
      pattern.lastIndex = 0;
      const value = pattern.exec(text)?.[0] ?? "";
      // 行首尾空白由调用链的空白字段独立保存，不能再次作为保护前后缀恢复。
      if (value === "" || value.trim() === "") {
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

/** 将预设条目收窄为匹配器所需的唯一字段。 */
function create_text_preserve_pattern_definitions(
  entries: readonly { src: string }[],
): TextPreservePatternDefinition[] {
  return entries.map((entry) => ({ source: entry.src }));
}

/** 根据模式选择智能预设或项目自定义附加规则。 */
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
    }));
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
    ...BASE_PATTERNS,
    ...resolve_text_preserve_pattern_definitions(args),
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
