import { CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE } from "../rules/languages";
import type { TextJsonRecord } from "./text-types";

export type TextPreserveMode = "off" | "smart" | "custom";

export type TextPreserveRuleKind = "check" | "sample" | "prefix" | "suffix";

// NONE 规则是所有文本类型的最小保护集合，避免 `<br>` 和空白段参与差异检查。
const NONE_PATTERNS = ["<br>", "\\s"] as const;

// Ren'Py/KAG 控制段内部若含中日韩正文，就不能当作可保护脚手架。
const RENPY_LIKE_PATTERNS = [
  `\\{[^\\{${CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE}]*?\\}`,
  `\\[[^\\[${CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE}]*?\\]`,
  ...NONE_PATTERNS,
] as const;

// RPGMaker/WOLF 共享控制码形态较多，集中在同一组规则避免校对页和任务侧漂移。
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

// 按 text_type 映射智能保护规则，任务 worker 和校对页必须共用同一张表。
export const TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE = {
  NONE: NONE_PATTERNS,
  MD: NONE_PATTERNS,
  KAG: RENPY_LIKE_PATTERNS,
  RENPY: RENPY_LIKE_PATTERNS,
  RPGMAKER: RPGMAKER_LIKE_PATTERNS,
  WOLF: RPGMAKER_LIKE_PATTERNS,
} as const;

/**
 * 运行态 mode 来自 meta，可能是小写、旧大写或坏值；坏值按旧 Py 口径关闭。
 */
export function normalize_text_preserve_mode(value: string): TextPreserveMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "smart" || normalized === "custom") {
    return normalized;
  }
  return "off";
}

/**
 * 根据 mode 和 text_type 展开可执行正则片段，custom 只读用户 entries，smart 只读预置表。
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
    return args.entries.map((entry) => String(entry["src"] ?? "").trim()).filter(Boolean);
  }
  const text_type = args.text_type.toUpperCase();
  const key = (
    text_type in TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE ? text_type : "NONE"
  ) as keyof typeof TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE;
  return [...TEXT_PRESERVE_SMART_PATTERNS_BY_TEXT_TYPE[key]];
}

/**
 * 构造保护正则。返回 null 代表当前模式下没有任何保护规则。
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
