import { has_language_character } from "../../shared/rules/languages";
import type { FileTextType } from "./file-item";

// 这些启发式只用于 旧实现同款兜底推断，不能替代具体格式处理器的 text_type。
// WOLF 行常见以事件编号或数据库控制码开头，命中后优先级最高。
const WOLF_PATTERNS = [/@\d+/iu, /\\[cus]db\[.+?:.+?:.+?\]/iu];

// RPGMaker 控制语法比 Ren'Py 更具体，必须先于通用括号 tag 判断。
const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu,
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu,
];

// Ren'Py/KAG 只识别括号外壳，内部是否含正文语言字符由共享语言规则判断。
const RENPY_CONTROL_TAG_PATTERN = /\{([^{}]*?)\}|\[([^[\]]*?)\]/giu;

/**
 * 缺少显式 text_type 时按原文内容兜底推断引擎类型。
 */
export function infer_text_type_from_source(src: string): FileTextType {
  if (WOLF_PATTERNS.some((pattern) => pattern.test(src))) {
    return "WOLF";
  }
  if (RPGMAKER_PATTERNS.some((pattern) => pattern.test(src))) {
    return "RPGMAKER";
  }
  if (has_renpy_control_tag(src)) {
    return "RENPY";
  }
  return "NONE";
}

/**
 * Ren'Py 控制 tag 通常包在 `{}` 或 `[]`，内部若含中日韩正文就不能当控制脚手架。
 */
function has_renpy_control_tag(src: string): boolean {
  RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
  for (const match of src.matchAll(RENPY_CONTROL_TAG_PATTERN)) {
    const body = String(match[1] ?? match[2] ?? "");
    if (!has_language_character(body, "JA") && !has_language_character(body, "KO")) {
      RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
      return true;
    }
  }
  RENPY_CONTROL_TAG_PATTERN.lastIndex = 0;
  return false;
}
