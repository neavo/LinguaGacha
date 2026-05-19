import { build_skeleton, normalize_speaker_token, normalize_ws } from "./lexer";
import type { RenpyStatementNode, RenpyTranslateBlock } from "./types";

/**
 * Character(...) 内的字符串属于角色名，括号后的连续字符串才是对白组。
 */
export function find_character_name_lit_index(stmt: RenpyStatementNode): number | null {
  const stripped = stmt.code.trimStart();
  if (!stripped.startsWith("Character(")) {
    return null;
  }
  const open_pos = stmt.code.indexOf("(");
  const close_pos = find_matching_paren(stmt, open_pos);
  if (close_pos === null) {
    return null;
  }
  const index = stmt.literals.findIndex(
    (literal) => open_pos < literal.start_col && literal.start_col < close_pos,
  );
  return index >= 0 ? index : null;
}

/**
 * 跳过字符串字面量匹配括号，避免 Character(")") 误关括号。
 */
export function find_matching_paren(stmt: RenpyStatementNode, open_pos: number): number | null {
  if (open_pos < 0) {
    return null;
  }
  let literal_index = 0;
  let depth = 0;
  let code_index = open_pos;
  while (code_index < stmt.code.length) {
    const literal = stmt.literals[literal_index];
    if (literal !== undefined && code_index === literal.start_col) {
      code_index = literal.end_col;
      literal_index += 1;
      continue;
    }
    const char = stmt.code[code_index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return code_index;
      }
    }
    code_index += 1;
  }
  return null;
}

/**
 * 对白组只接受中间全是空白的连续字符串，尾随函数参数不参与翻译槽位。
 */
export function find_dialogue_string_group(
  stmt: RenpyStatementNode,
  character_name_index: number | null = null,
): number[] {
  if (stmt.literals.length === 0) {
    return [];
  }
  const start_col = get_dialogue_start_col(stmt, character_name_index);
  if (start_col === null) {
    return [];
  }
  const start_index = find_first_string_after_col(stmt, start_col);
  if (start_index === null) {
    return [];
  }
  const result = [start_index];
  for (let index = start_index + 1; index < stmt.literals.length; index += 1) {
    const previous = stmt.literals[index - 1];
    const current = stmt.literals[index];
    if (previous === undefined || current === undefined) {
      break;
    }
    if (stmt.code.slice(previous.end_col, current.start_col).trim() !== "") {
      break;
    }
    result.push(index);
  }
  return result;
}

/**
 * 从指定列后寻找首个字符串，用于 Character(...) 后对白定位。
 */
export function find_first_string_after_col(
  stmt: RenpyStatementNode,
  start_col: number,
): number | null {
  const index = stmt.literals.findIndex((literal) => literal.start_col >= start_col);
  return index >= 0 ? index : null;
}

/**
 * Character(...) 的角色名和后续对白不能被当成同一个连续字符串组。
 */
function get_dialogue_start_col(
  stmt: RenpyStatementNode,
  character_name_index: number | null,
): number | null {
  if (character_name_index === null) {
    return 0;
  }
  const open_pos = stmt.code.indexOf("(");
  const close_pos = find_matching_paren(stmt, open_pos);
  return close_pos === null ? null : close_pos + 1;
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
  if (match_end_col >= stmt.code.length) {
    return {
      string_count: stmt.string_count,
      strict_key: stmt.strict_key,
      relaxed_key: stmt.relaxed_key,
    };
  }
  const matched_code = stmt.code.slice(0, match_end_col);
  const matched_literals = stmt.literals.filter((literal) => literal.end_col <= match_end_col);
  const strict_key = build_skeleton(matched_code, matched_literals);
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
  const name_index = find_character_name_lit_index(stmt);
  const dialogue_group = find_dialogue_string_group(stmt, name_index);
  const dialogue_index = dialogue_group.at(-1);
  return dialogue_index === undefined
    ? stmt.code.length
    : (stmt.literals[dialogue_index]?.end_col ?? stmt.code.length);
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
  if (stripped.startsWith('"') || stripped.startsWith("Character(")) {
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
