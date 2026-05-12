import { CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE } from "../language";
import type { TextJsonRecord } from "./text-types";
export { normalize_text_preserve_mode, type TextPreserveMode } from "../../base/quality";
import { normalize_text_preserve_mode } from "../../base/quality";

export type TextPreserveRuleKind = "check" | "sample" | "prefix" | "suffix";

const NONE_PATTERNS = ["<br>", "\\s"] as const; // NONE 规则是所有文本类型的最小保护集合，避免 `<br>` 和空白段参与差异检查

// Ren'Py/KAG 控制段内部若含中日韩正文，就不能当作可保护脚手架
const RENPY_LIKE_PATTERNS = [
  `\\{[^\\{${CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE}]*?\\}`,
  `\\[[^\\[${CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE}]*?\\]`,
  ...NONE_PATTERNS,
] as const;

// RPGMaker/WOLF 共享控制码形态较多，集中在同一组规则避免校对页和任务侧漂移
const RPGMAKER_LIKE_PATTERNS = [
  "<.+?:.+?>",
  "en\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)",
  "if\\(.{0,8}[vs]\\[\\d+\\].{0,16}\\)",
  "[<【]{0,1}[/\\\\][a-z]{1,8}[<\\[][a-z\\d]{0,16}[>\\]][>】]{0,1}",
  "%\\d+",
  "@\\d+",
  "\\\\[cus]db\\[.+?:.+?:.+?\\]",
  "\\\\f[rbi]",
  "\\\\[\\{\\}]",
  "\\\\\\$",
  "\\\\\\.",
  "\\\\\\|",
  "\\\\!",
  "\\\\>",
  "\\\\<",
  "\\\\\\^",
  "[/\\\\][a-z]{1,8}(?=<.{0,16}>|\\[.{0,16}\\])",
  "\\\\[a-z](?=[^a-z<>\\[\\]])",
  ...NONE_PATTERNS,
] as const;

// 按 text_type 映射智能保护规则，任务 worker 和校对页必须共用同一张表
export const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: NONE_PATTERNS,
  MD: NONE_PATTERNS,
  KAG: RENPY_LIKE_PATTERNS,
  RENPY: RENPY_LIKE_PATTERNS,
  RPGMAKER: RPGMAKER_LIKE_PATTERNS,
  WOLF: RPGMAKER_LIKE_PATTERNS,
} as const;

/**
 * 根据 mode 和 text_type 展开可执行正则片段，custom 只读用户 entries，smart 只读预置表
 */
export function resolve_text_preserve_patterns(args: {
  mode: string;
  text_type: string;
  entries: TextJsonRecord[];
}): string[] {
  const mode = normalize_text_preserve_mode(args.mode);
  if (mode === "off") {
    return [];
  }
  if (mode === "custom") {
    return args.entries
      .map((entry) => entry["src"])
      .filter((src): src is string => typeof src === "string")
      .map((src) => src.trim())
      .filter(Boolean);
  }
  const text_type = args.text_type.toUpperCase();
  const key = (
    text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE ? text_type : "NONE"
  ) as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE;
  return [...TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[key]];
}

/**
 * 构造保护正则。返回 null 代表当前模式下没有任何保护规则
 */
export function build_text_preserve_rule(args: {
  mode: string;
  text_type: string;
  entries: TextJsonRecord[];
  kind: TextPreserveRuleKind;
}): RegExp | null {
  const parts = resolve_text_preserve_patterns(args);
  if (parts.length === 0) {
    return null;
  }
  const body = parts.join("|");
  if (args.kind === "check") {
    return new RegExp(`(?:${body})+`, "giu");
  }
  if (args.kind === "sample") {
    return new RegExp(body, "giu");
  }
  if (args.kind === "prefix") {
    return new RegExp(`^(?:${body})+`, "giu");
  }
  return new RegExp(`(?:${body})+$`, "giu");
}

const BLANK_PATTERN = /\s+/gu;

/**
 * 统一提取并归一化非空保护段，供响应检查和迁移对拍复用
 */
export function collect_non_blank_text_preserve_segments(text: string, rule: RegExp): string[] {
  rule.lastIndex = 0;
  const segments: string[] = [];
  for (const match of text.matchAll(rule)) {
    const segment = (match[0] ?? "").replace(BLANK_PATTERN, "");
    if (segment !== "") {
      segments.push(segment);
    }
  }
  rule.lastIndex = 0;
  return segments;
}

/**
 * 按保护段序列比较源文和译文，避免保护段位置移动造成误判
 */
export function are_text_preserve_segments_equal(src: string, dst: string, rule: RegExp): boolean {
  const src_segments = collect_non_blank_text_preserve_segments(src, rule);
  const dst_segments = collect_non_blank_text_preserve_segments(dst, rule);
  return src_segments.join("\u0000") === dst_segments.join("\u0000");
}
