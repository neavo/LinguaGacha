import { build_skeleton, normalize_speaker_token, normalize_ws } from "./lexer";
import type { RenpyStatementNode, RenpyTranslateBlock } from "./types";

const SAY_SUFFIX_KEYWORDS = new Set(["with", "nointeract", "id"]);

/** 顶层字符串才可能是正文；调用、括号和下标中的字符串属于 who 表达式。 */
export function find_dialogue(
  stmt: RenpyStatementNode,
): { index: number; who_end: number } | undefined {
  let depth = 0,
    literal_index = 0,
    who_end: number | undefined;
  const top: number[] = [];
  for (let at = 0; at < stmt.code.length; at++) {
    const literal = stmt.literals[literal_index];
    if (literal && at === literal.start_col) {
      if (depth === 0) top.push(literal_index);
      at = literal.end_col - 1;
      literal_index++;
      continue;
    }
    if (stmt.code[at] === "#") break;
    // who 可带调用或属性链；其后的顶层单词是角色属性，不属于 Python 表达式。
    if (depth === 0 && who_end === undefined && /\s/u.test(stmt.code[at]!)) {
      const before = stmt.code.slice(0, at).trimEnd();
      const after = stmt.code.slice(at).trimStart();
      if (before && !before.endsWith(".") && !/^(?:\.|\(|\[)/u.test(after)) who_end = at;
    }
    if ("([{".includes(stmt.code[at]!)) depth++;
    if (")]}".includes(stmt.code[at]!)) depth--;
  }
  const first = top[0];
  if (first === undefined) return undefined;
  const literal = stmt.literals[first]!;
  // 裸姓名与正文之间允许角色属性；with 等尾随关键字仍属于旁白后缀。
  if (!stmt.code.slice(0, literal.start_col).trim()) {
    const second = top[1];
    if (second !== undefined) {
      const attributes = stmt.code.slice(literal.end_col, stmt.literals[second]!.start_col).trim();
      if (
        /^[\s\p{ID_Continue}@-]*$/u.test(attributes) &&
        !attributes.split(/\s+/u).some((word) => SAY_SUFFIX_KEYWORDS.has(word))
      )
        return { index: second, who_end: literal.end_col };
    }
    return { index: first, who_end: 0 };
  }
  return { index: first, who_end: who_end ?? literal.start_col };
}

/**
 * 匹配只比较对白相关片段，尾随 with/cb_name 参数交给写回器从模板恢复。
 */
function build_statement_match_signature(stmt: RenpyStatementNode): {
  string_count: number;
  strict_key: string;
  relaxed_key: string;
} {
  if (stmt.block_kind !== "LABEL" || stmt.literals.length === 0) {
    return {
      string_count: stmt.string_count,
      strict_key: stmt.strict_key,
      relaxed_key: stmt.relaxed_key,
    };
  }
  const match_end_col = find_label_match_end_col(stmt);
  const matched_code = stmt.code.slice(0, match_end_col);
  const matched_literals = stmt.literals.filter((literal) => literal.end_col <= match_end_col);
  // 写回可将原始姓名字面量转为普通 Python 字面量，配对不依赖前缀。
  const strict_key = build_skeleton(
    matched_code,
    matched_literals.map((literal) => ({ ...literal, raw: false })),
  );
  return {
    string_count: matched_literals.length,
    strict_key,
    relaxed_key: normalize_ws(normalize_speaker_token(strict_key)),
  };
}

/**
 * label 匹配终点落在对白字面量末尾，防止 PushMove("x") 参与字符串数量校验。
 */
function find_label_match_end_col(stmt: RenpyStatementNode): number {
  const dialogue = find_dialogue(stmt);
  return dialogue ? stmt.literals[dialogue.index]!.end_col : stmt.code.length;
}

/**
 * speaker token 不兼容时禁止宽松骨架匹配，避免不同角色对白错配。
 */
function speakers_are_compatible(
  template: RenpyStatementNode,
  target: RenpyStatementNode,
): boolean {
  const template_speaker = get_statement_speaker_token(template);
  const target_speaker = get_statement_speaker_token(target);
  if (template_speaker === null && target_speaker === null) {
    return true;
  }
  return template_speaker === target_speaker;
}

/**
 * 裸字符串和 Character(...) 没有 speaker 变量，避免把角色名错当变量。
 */
function get_statement_speaker_token(stmt: RenpyStatementNode): string | null {
  const stripped = stmt.code.trimStart();
  if (/^(?:[ru]*['"(]|(?:Character|_)\s*\()/iu.test(stripped)) {
    return null;
  }
  return stmt.code.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\b/u)?.[1] ?? null;
}

/**
 * 当一侧骨架已归一 speaker 时，去掉占位符再与另一侧严格骨架比较。
 */
function drop_normalized_speaker(key: string): string {
  const prefix = "<SPEAKER> ";
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/**
 * 两条 RenPy 语句同构时才能配对，字符串数量和语句骨架必须同时通过。
 */
export function statements_equal(
  template: RenpyStatementNode,
  target: RenpyStatementNode,
): boolean {
  const template_signature = build_statement_match_signature(template);
  const target_signature = build_statement_match_signature(target);
  if (template_signature.string_count !== target_signature.string_count) {
    return false;
  }
  if (template_signature.strict_key === target_signature.strict_key) {
    return true;
  }
  if (!speakers_are_compatible(template, target)) {
    return false;
  }
  if (template_signature.relaxed_key === target_signature.relaxed_key) {
    return true;
  }
  if (template_signature.strict_key === drop_normalized_speaker(target_signature.relaxed_key)) {
    return true;
  }
  return drop_normalized_speaker(template_signature.relaxed_key) === target_signature.strict_key;
}

/**
 * label 块用 LCS 配对模板与目标，保持跳过无关行后的稳定顺序。
 */
export function match_template_to_target(block: RenpyTranslateBlock): Map<number, number> {
  const templates = block.statements.filter(
    (statement) => statement.stmt_kind === "TEMPLATE" && statement.strict_key !== "",
  );
  const targets = block.statements.filter(
    (statement) => statement.stmt_kind === "TARGET" && statement.strict_key !== "",
  );
  if (templates.length === 0 || targets.length === 0) {
    return new Map();
  }

  const dp = Array.from({ length: templates.length + 1 }, () =>
    Array<number>(targets.length + 1).fill(0),
  );
  for (let template_index = templates.length - 1; template_index >= 0; template_index -= 1) {
    for (let target_index = targets.length - 1; target_index >= 0; target_index -= 1) {
      dp[template_index]![target_index] = statements_equal(
        templates[template_index]!,
        targets[target_index]!,
      )
        ? (dp[template_index + 1]![target_index + 1] ?? 0) + 1
        : Math.max(
            dp[template_index + 1]![target_index] ?? 0,
            dp[template_index]![target_index + 1] ?? 0,
          );
    }
  }

  const mapping = new Map<number, number>();
  let template_index = 0;
  let target_index = 0;
  while (template_index < templates.length && target_index < targets.length) {
    if (statements_equal(templates[template_index]!, targets[target_index]!)) {
      mapping.set(templates[template_index]!.line_no, targets[target_index]!.line_no);
      template_index += 1;
      target_index += 1;
      continue;
    }
    if (
      (dp[template_index + 1]![target_index] ?? 0) >= (dp[template_index]![target_index + 1] ?? 0)
    ) {
      template_index += 1;
    } else {
      target_index += 1;
    }
  }
  return mapping;
}

/**
 * strings 块只按 old 后紧随的 new 配对，不跨越第二个 old。
 */
export function pair_old_new(block: RenpyTranslateBlock): Map<number, number> {
  const mapping = new Map<number, number>();
  let pending_old_line: number | null = null;
  for (const statement of block.statements) {
    const code = statement.code.trim();
    if (statement.stmt_kind === "TEMPLATE" && code.startsWith("old ")) {
      pending_old_line = statement.line_no;
      continue;
    }
    if (statement.stmt_kind === "TARGET" && code.startsWith("new ") && pending_old_line !== null) {
      mapping.set(pending_old_line, statement.line_no);
      pending_old_line = null;
    }
  }
  return mapping;
}
