import {
  build_skeleton,
  normalize_speaker_token,
  normalize_ws,
  scan_double_quoted_literals,
  split_indent,
  strip_comment_prefix,
} from "./lexer";
import type {
  RenpyBlockKind,
  RenpyDocument,
  RenpyStatementKind,
  RenpyStatementNode,
  RenpyTranslateBlock,
} from "./types";

// translate 头部同时服务当前解析器和历史字符串 extra 迁移。
const TRANSLATE_HEADER_PATTERN = /^translate\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*:\s*$/u;

// 官方导出的位置注释只做上下文，不参与可翻译语句匹配。
const GAME_LOCATION_PATTERN = /^game\/.+?:\d+\s*$/u;

/**
 * translate 头部解析是块归属和历史迁移的共同入口。
 */
export function parse_translate_header(line: string): { lang: string; label: string } | null {
  const match = line.trim().match(TRANSLATE_HEADER_PATTERN);
  if (match === null) {
    return null;
  }
  return { lang: match[1] ?? "", label: match[2] ?? "" };
}

/**
 * label 名决定 translate 块语义；python 块不进入文本抽取。
 */
export function classify_block_kind(label: string): RenpyBlockKind {
  if (label === "strings") {
    return "STRINGS";
  }
  if (label === "python") {
    return "PYTHON";
  }
  return "LABEL";
}

/**
 * RenPy 位置注释和 TODO 只提供上下文，不参与模板目标匹配。
 */
function is_meta_comment_content(content: string): boolean {
  const stripped = content.trim();
  return stripped.startsWith("TODO:") || GAME_LOCATION_PATTERN.test(stripped);
}

/**
 * 单行语句分类后立即生成字面量与骨架，后续阶段不再重复扫描原行。
 */
export function parse_statement(
  line_no: number,
  raw_line: string,
  block_kind: RenpyBlockKind,
): RenpyStatementNode {
  if (raw_line.trim() === "") {
    return {
      line_no,
      raw_line,
      indent: "",
      code: "",
      stmt_kind: "BLANK",
      block_kind,
      literals: [],
      strict_key: "",
      relaxed_key: "",
      string_count: 0,
    };
  }

  const [indent, rest] = split_indent(raw_line);
  const comment = strip_comment_prefix(rest);
  let code = rest;
  let stmt_kind: RenpyStatementKind = "OTHER";

  if (comment.is_comment) {
    code = comment.content;
    stmt_kind = is_meta_comment_content(comment.content) ? "META" : "TEMPLATE";
  } else if (block_kind === "STRINGS" && rest.startsWith("old ")) {
    stmt_kind = "TEMPLATE";
  } else if (block_kind === "STRINGS" && rest.startsWith("new ")) {
    stmt_kind = "TARGET";
  } else {
    stmt_kind = "TARGET";
  }

  const literals = scan_double_quoted_literals(code);
  const strict_key = build_skeleton(code, literals);
  const relaxed_key =
    block_kind === "LABEL" ? normalize_ws(normalize_speaker_token(strict_key)) : strict_key;
  return {
    line_no,
    raw_line,
    indent,
    code,
    stmt_kind,
    block_kind,
    literals,
    strict_key,
    relaxed_key,
    string_count: literals.length,
  };
}

/**
 * 文档解析只扫描 translate 块边界，槽位选择推迟到抽取器完成。
 */
export function parse_document(lines: string[]): RenpyDocument {
  const blocks: RenpyTranslateBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = parse_translate_header(lines[index] ?? "");
    if (header === null) {
      index += 1;
      continue;
    }

    const kind = classify_block_kind(header.label);
    const header_line_no = index + 1;
    index += 1;

    const statements: RenpyStatementNode[] = [];
    while (index < lines.length && parse_translate_header(lines[index] ?? "") === null) {
      statements.push(parse_statement(index + 1, lines[index] ?? "", kind));
      index += 1;
    }

    blocks.push({
      header_line_no,
      lang: header.lang,
      label: header.label,
      kind,
      statements,
    });
  }
  return { lines, blocks };
}
