import { createHash } from "node:crypto";

import type { RenpyStringLiteral } from "./types";
import { remove_text_resource_references } from "../../../shared/text/text-resource-reference";

// 字符串占位符必须固定，解析器和写回器的骨架摘要才可互相校验。
const SKELETON_PLACEHOLDER = '"{}"';

/**
 * 分离行首缩进和代码体，写回器复用缩进写回目标行。
 */
export function split_indent(raw_line: string): [indent: string, rest: string] {
  let index = 0;
  while (index < raw_line.length && (raw_line[index] === " " || raw_line[index] === "\t")) {
    index += 1;
  }
  return [raw_line.slice(0, index), raw_line.slice(index)];
}

/**
 * RenPy 模板注释只剥一层井号和一个可选空格，保留代码体内部空白。
 */
export function strip_comment_prefix(text: string): {
  is_comment: boolean;
  content: string;
} {
  if (!text.startsWith("#")) {
    return { is_comment: false, content: text };
  }
  const content = text[1] === " " ? text.slice(2) : text.slice(1);
  return { is_comment: true, content };
}

/**
 * SHA1 只用于行定位摘要和诊断，不承担安全校验语义。
 */
export function sha1_hex(text: string): string {
  return createHash("sha1").update(text, "utf-8").digest("hex");
}

/**
 * RenPy 语句骨架统一压缩空白，降低缩进和多空格对配对的干扰。
 */
export function normalize_ws(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

// 按 Ren’Py `Lexer.string()` 解释转义与空白：https://github.com/renpy/renpy/blob/master/renpy/lexer.py
const RENPY_TEXT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  n: "\n",
  "{": "{{",
  "[": "[[",
  "%": "%%",
});
const RENPY_LITERAL_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
});

/** 普通字符串先按 Ren’Py 规则折叠空白，再单次消费转义，解码结果不再次解释。 */
export function unescape_renpy_string(raw_inner: string): string {
  return raw_inner
    .replace(/[ \n]+/gu, " ")
    .replace(
      /\\(u([0-9a-fA-F]{1,4})|.)/gu,
      (_match: string, token: string, unicode: string | undefined) => {
        if (unicode !== undefined) return String.fromCharCode(Number.parseInt(unicode, 16));
        if (token === "u") throw new SyntaxError("Invalid RenPy Unicode escape.");
        return RENPY_TEXT_ESCAPES[token] ?? token;
      },
    );
}

/** 普通双引号输出保留文本值；连续空格和行边界使用显式转义以避免折叠或断行。 */
export function escape_renpy_string(text: string): string {
  return text.replace(/[\\"\p{Cc}\p{Zl}\p{Zp}]| {2,}/gu, (token) => {
    if (token[0] === " ") return " " + "\\ ".repeat(token.length - 1);
    return (
      RENPY_LITERAL_ESCAPES[token] ?? `\\u${token.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  });
}

/** 扫描单行双引号字面量及 r 前缀，保存整个源码范围；未闭合字面量拒绝扫描。 */
export function scan_double_quoted_literals(code: string): RenpyStringLiteral[] {
  const literals: RenpyStringLiteral[] = [];
  let index = 0;
  while (index < code.length) {
    if (code[index] !== '"') {
      index += 1;
      continue;
    }
    const raw =
      code[index - 1] === "r" && (index === 1 || !/[\p{ID_Continue}]/u.test(code[index - 2]!));
    const start_col = raw ? index - 1 : index;
    const content_start = ++index;
    let closed = false; // 结尾是被转义的引号时也不能当作已闭合。
    while (index < code.length) {
      if (code[index] === "\\") {
        index += 2;
        continue;
      }
      if (code[index] === '"') {
        const inner = code.slice(content_start, index);
        literals.push({
          start_col,
          end_col: ++index,
          raw,
          value: raw ? inner : unescape_renpy_string(inner),
        });
        closed = true;
        break;
      }
      index += 1;
    }
    if (!closed) return [];
  }
  return literals;
}

/**
 * 将字符串字面量替换为占位符后生成骨架，解析、匹配和写回共用同一口径。
 */
export function build_skeleton(
  code: string,
  literals: RenpyStringLiteral[] = scan_double_quoted_literals(code),
): string {
  if (literals.length === 0) {
    return normalize_ws(code);
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const literal of literals) {
    // 保留原始前缀的骨架表达，已有工程的目标摘要仍可核验。
    parts.push(
      code.slice(cursor, literal.start_col),
      literal.raw ? "r" + SKELETON_PLACEHOLDER : SKELETON_PLACEHOLDER,
    );
    cursor = literal.end_col;
  }
  parts.push(code.slice(cursor));
  return normalize_ws(parts.join(""));
}

/**
 * 角色变量在安全匹配分支中归一化，避免翻译目标行变量名差异破坏配对。
 */
export function normalize_speaker_token(code: string): string {
  const stripped = code.trimStart();
  if (stripped.startsWith('"') || stripped.startsWith('r"')) {
    return code;
  }
  return code.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\b.*)$/u, "$1<SPEAKER>$3");
}

/**
 * 完整资源引用字面量不进入翻译，避免 URI、Base64 和资源文件名被误写。
 */
export function looks_like_resource_reference(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return false;
  }
  return remove_text_resource_references(trimmed).trim() === "";
}

/**
 * 文本可翻译性过滤只排除纯占位和纯样式，保留 RenPy 官方可翻译 image 标记。
 */
export function is_translatable_text(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return false;
  }
  if (/^\[[^\]]+\]$/u.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("{#") || trimmed.toLowerCase().startsWith("{image=")) {
    return true;
  }
  const cleaned = text
    .replace(/\{[^{}]*\}/gu, "")
    .replace(/\[[^[\]]*\]/gu, "")
    .trim();
  return cleaned !== "";
}
