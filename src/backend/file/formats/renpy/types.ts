// RenPy AST extra 的当前版本，兼容层用它判断是否可直接交给写回器。
export const RENPY_EXTRA_VERSION = 1;

// translate 块类型集中定义，避免解析器、抽取器、写回器各自散落字符串。
export type RenpyBlockKind = "LABEL" | "STRINGS" | "PYTHON" | "OTHER";

// 语句类型只表达 AST 阶段语义，不映射到任何公开 API 字段。
export type RenpyStatementKind = "TEMPLATE" | "TARGET" | "META" | "BLANK" | "OTHER";

// 槽位角色是写回器的唯一写入意图来源。
export type RenpySlotRole = "DIALOGUE" | "NAME" | "STRING";

/**
 * RenPy 双引号字面量必须保留列号，写回时才能精准替换目标槽位。
 */
export interface RenpyStringLiteral {
  start_col: number;
  end_col: number;
  raw_inner: string;
  value: string;
}

/**
 * 槽位只表达可写文本的角色，不承载实际译文，避免解析与导出互相污染。
 */
export interface RenpySlot {
  role: RenpySlotRole;
  lit_index: number;
}

/**
 * 单行语句节点保存原始行、代码体和匹配骨架，是解析器到写回器的最小 AST 单元。
 */
export interface RenpyStatementNode {
  line_no: number;
  raw_line: string;
  indent: string;
  code: string;
  stmt_kind: RenpyStatementKind;
  block_kind: RenpyBlockKind;
  literals: RenpyStringLiteral[];
  strict_key: string;
  relaxed_key: string;
  string_count: number;
}

/**
 * translate 块是 old/new strings 与 label 对白匹配的边界，跨块不做配对。
 */
export interface RenpyTranslateBlock {
  header_line_no: number;
  lang: string;
  label: string;
  kind: RenpyBlockKind;
  statements: RenpyStatementNode[];
}

/**
 * 文档 AST 只保存 splitlines 后的行和 translate 块，不复制文件系统状态。
 */
export interface RenpyDocument {
  lines: string[];
  blocks: RenpyTranslateBlock[];
}

export type RenpyAstKey = readonly [lang: string, label: string, digest: string];
