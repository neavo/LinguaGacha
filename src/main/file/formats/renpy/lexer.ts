import path from "node:path";
import { createHash } from "node:crypto";

import type { RenpyStringLiteral } from "./types";

// 字符串占位符必须固定，解析器和写回器的骨架摘要才可互相校验。
const SKELETON_PLACEHOLDER = '"{}"';

// 资源扩展名沿用 RenPy 游戏常见资产类型，避免文件名被当成翻译文本。
const RESOURCE_EXTENSIONS = new Set([
  ".mp3",
  ".ogg",
  ".wav",
  ".flac",
  ".opus",
  ".mp4",
  ".webm",
  ".avi",
  ".mkv",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

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

/**
 * 解析 RenPy 字符串里旧实现覆盖的基础转义，避免把控制符当成正文字符。
 */
export function unescape_renpy_string(raw_inner: string): string {
  return raw_inner.replace(/\\"/gu, '"').replace(/\\n/gu, "\n");
}

/**
 * 写回字符串时转义反斜杠、双引号和换行，保持输出仍是合法 RenPy 字面量。
 */
export function escape_renpy_string(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}

/**
 * 扫描双引号字面量并记录原始范围；未闭合引号视为整行不可安全解析。
 */
export function scan_double_quoted_literals(code: string): RenpyStringLiteral[] {
  const literals: RenpyStringLiteral[] = [];
  let index = 0;
  while (index < code.length) {
    if (code[index] !== '"') {
      index += 1;
      continue;
    }
    const start_col = index;
    index += 1;
    let raw_inner = "";
    while (index < code.length) {
      const char = code[index];
      if (char === "\\" && index + 1 < code.length) {
        raw_inner += `${code[index] ?? ""}${code[index + 1] ?? ""}`;
        index += 2;
        continue;
      }
      if (char === '"') {
        const end_col = index + 1;
        literals.push({
          start_col,
          end_col,
          raw_inner,
          value: unescape_renpy_string(raw_inner),
        });
        index = end_col;
        break;
      }
      raw_inner += char ?? "";
      index += 1;
    }
    if (index >= code.length && code[index - 1] !== '"') {
      return [];
    }
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
    parts.push(code.slice(cursor, literal.start_col), SKELETON_PLACEHOLDER);
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
  if (stripped.startsWith('"')) {
    return code;
  }
  return code.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\b.*)$/u, "$1<SPEAKER>$3");
}

/**
 * 资源路径字面量不进入翻译，避免图片、音频和字体文件名被误写。
 */
export function looks_like_resource_path(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return false;
  }
  return RESOURCE_EXTENSIONS.has(path.extname(path.basename(trimmed)).toLowerCase());
}

/**
 * 文本可翻译性过滤只排除纯占位、纯样式和资源路径，保留 RenPy 官方可翻译 image 标记。
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
