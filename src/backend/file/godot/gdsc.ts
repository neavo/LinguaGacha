import assert from "node:assert/strict";
import { zstdDecompressSync, zstdCompressSync } from "node:zlib";
import { Reader, GODOT_RESOURCE_MAX_BYTES, u32, splice } from "./binary";
import { read_variant, variant_string, type Value } from "./variant";
/** GDSC 100 沿用 4.3 的 `Token::Type` 顺序。 */
const GDSC_TOKENS_100 = [
  "EMPTY",
  "ANNOTATION",
  "IDENTIFIER",
  "LITERAL",
  "LESS",
  "LESS_EQUAL",
  "GREATER",
  "GREATER_EQUAL",
  "EQUAL_EQUAL",
  "BANG_EQUAL",
  "AND",
  "OR",
  "NOT",
  "AMPERSAND_AMPERSAND",
  "PIPE_PIPE",
  "BANG",
  "AMPERSAND",
  "PIPE",
  "TILDE",
  "CARET",
  "LESS_LESS",
  "GREATER_GREATER",
  "PLUS",
  "MINUS",
  "STAR",
  "STAR_STAR",
  "SLASH",
  "PERCENT",
  "EQUAL",
  "PLUS_EQUAL",
  "MINUS_EQUAL",
  "STAR_EQUAL",
  "STAR_STAR_EQUAL",
  "SLASH_EQUAL",
  "PERCENT_EQUAL",
  "LESS_LESS_EQUAL",
  "GREATER_GREATER_EQUAL",
  "AMPERSAND_EQUAL",
  "PIPE_EQUAL",
  "CARET_EQUAL",
  "IF",
  "ELIF",
  "ELSE",
  "FOR",
  "WHILE",
  "BREAK",
  "CONTINUE",
  "PASS",
  "RETURN",
  "MATCH",
  "WHEN",
  "AS",
  "ASSERT",
  "AWAIT",
  "BREAKPOINT",
  "CLASS",
  "CLASS_NAME",
  "CONST",
  "ENUM",
  "EXTENDS",
  "FUNC",
  "IN",
  "IS",
  "NAMESPACE",
  "PRELOAD",
  "SELF",
  "SIGNAL",
  "STATIC",
  "SUPER",
  "TRAIT",
  "VAR",
  "VOID",
  "YIELD",
  "BRACKET_OPEN",
  "BRACKET_CLOSE",
  "BRACE_OPEN",
  "BRACE_CLOSE",
  "PARENTHESIS_OPEN",
  "PARENTHESIS_CLOSE",
  "COMMA",
  "SEMICOLON",
  "PERIOD",
  "PERIOD_PERIOD",
  "COLON",
  "DOLLAR",
  "FORWARD_ARROW",
  "UNDERSCORE",
  "NEWLINE",
  "INDENT",
  "DEDENT",
  "CONST_PI",
  "CONST_TAU",
  "CONST_INF",
  "CONST_NAN",
  "VCS_CONFLICT_MARKER",
  "BACKTICK",
  "QUESTION_MARK",
  "ERROR",
  "TK_EOF",
] as const;
const PERIOD_PERIOD_END = GDSC_TOKENS_100.indexOf("PERIOD_PERIOD") + 1;
// 4.6-stable 的 GDSC 101 在 PERIOD_PERIOD 后插入一项；TK_CONST / TK_IN / TK_VOID 沿用既有语义名。
const GDSC_TOKENS_101 = [
  ...GDSC_TOKENS_100.slice(0, PERIOD_PERIOD_END),
  "PERIOD_PERIOD_PERIOD",
  ...GDSC_TOKENS_100.slice(PERIOD_PERIOD_END),
] as const;
export type TokenKind = (typeof GDSC_TOKENS_101)[number];
export type Token = {
  index: number;
  start: number;
  end: number;
  kind: TokenKind; // GDSC 100 与 101 的原始编号含义不同，读取时按修订换算为名称。
  reference: number;
  line: number;
};
/** GDSC 100 与 101 使用不同头长和 token 编号，共享常量与 token 引用分别解析。 */
export function read_gdsc(bytes: Buffer) {
  const h = new Reader(bytes);
  assert(h.take(4).toString() === "GDSC");
  const version = h.u32();
  assert([100, 101].includes(version));
  const size = h.u32();
  assert(size <= GODOT_RESOURCE_MAX_BYTES);
  const body = size
    ? zstdDecompressSync(bytes.subarray(12), { maxOutputLength: GODOT_RESOURCE_MAX_BYTES })
    : bytes.subarray(12);
  if (size) assert.equal(body.length, size);
  const r = new Reader(body),
    identifiersCount = r.count(),
    constantsCount = r.count(),
    lineCount = r.count();
  if (version === 100) r.u32(); // GDSC 100 的 body 头含保留字段，共 20 字节；101 为 16 字节。
  const tokenCount = r.count();
  const identifiers: string[] = [];
  for (let i = 0; i < identifiersCount; i++) {
    const count = r.count(),
      raw = r.take(count * 4);
    const chars: string[] = [];
    for (let j = 0; j < count; j++) {
      const cp = (raw.readUInt32LE(j * 4) ^ 0xb6b6b6b6) >>> 0;
      assert(cp <= 0x10ffff);
      chars.push(String.fromCodePoint(cp));
    }
    identifiers.push(chars.join(""));
  }
  const constants: Value[] = [];
  for (let i = 0; i < constantsCount; i++) constants.push(read_variant(r));
  const constantsEnd = r.at;
  // 行表只登记逻辑行的首个 token：先是「序号 → 行号」，再是「序号 → 列号」，列号从 1 开始。
  r.take(lineCount * 8); // token 自带行号，两组的键相同，只保留列号。
  const columns = new Map<number, number>();
  for (let i = 0; i < lineCount; i++) columns.set(r.u32(), r.u32());
  const kinds = version === 100 ? GDSC_TOKENS_100 : GDSC_TOKENS_101;
  const tokens: Token[] = [];
  for (let i = 0; i < tokenCount; i++) {
    const start = r.at,
      wide = !!(body[start]! & 0x80),
      code = wide ? r.u32() : r.take(1)[0]!,
      kind = kinds[code & 0x7f],
      reference = code >>> 8,
      line = r.u32();
    assert(kind, "Invalid token kind");
    if (kind === "ANNOTATION" || kind === "IDENTIFIER") assert(reference < identifiers.length);
    if (kind === "LITERAL") assert(reference < constants.length);
    tokens.push({ index: i, start, end: r.at, kind, reference, line });
  }
  assert.equal(r.at, body.length, "GDC trailing data");
  return { version, body, identifiers, constants, constantsEnd, tokens, columns };
}
type Gdsc = ReturnType<typeof read_gdsc>;
const CONTINUATION_INDENT = 4; // 无列号的续行使用四空格，逻辑行缩进直接采用编译时记录的列号。
const SYMBOLS: Partial<Record<TokenKind, string>> = {
  LESS: "<",
  LESS_EQUAL: "<=",
  GREATER: ">",
  GREATER_EQUAL: ">=",
  EQUAL_EQUAL: "==",
  BANG_EQUAL: "!=",
  AMPERSAND_AMPERSAND: "&&",
  PIPE_PIPE: "||",
  BANG: "!",
  AMPERSAND: "&",
  PIPE: "|",
  TILDE: "~",
  CARET: "^",
  LESS_LESS: "<<",
  GREATER_GREATER: ">>",
  PLUS: "+",
  MINUS: "-",
  STAR: "*",
  STAR_STAR: "**",
  SLASH: "/",
  PERCENT: "%",
  EQUAL: "=",
  PLUS_EQUAL: "+=",
  MINUS_EQUAL: "-=",
  STAR_EQUAL: "*=",
  STAR_STAR_EQUAL: "**=",
  SLASH_EQUAL: "/=",
  PERCENT_EQUAL: "%=",
  LESS_LESS_EQUAL: "<<=",
  GREATER_GREATER_EQUAL: ">>=",
  AMPERSAND_EQUAL: "&=",
  PIPE_EQUAL: "|=",
  CARET_EQUAL: "^=",
  BRACKET_OPEN: "[",
  BRACKET_CLOSE: "]",
  BRACE_OPEN: "{",
  BRACE_CLOSE: "}",
  PARENTHESIS_OPEN: "(",
  PARENTHESIS_CLOSE: ")",
  COMMA: ",",
  SEMICOLON: ";",
  PERIOD: ".",
  PERIOD_PERIOD: "..",
  PERIOD_PERIOD_PERIOD: "...",
  COLON: ":",
  DOLLAR: "$",
  FORWARD_ARROW: "->",
  UNDERSCORE: "_",
  BACKTICK: "`",
  QUESTION_MARK: "?",
}; // 关键字按小写书写，`CONST_PI` 等常量去掉前缀。
const NO_SPACE_BEFORE = new Set<TokenKind>([
  "COMMA",
  "SEMICOLON",
  "PARENTHESIS_CLOSE",
  "BRACKET_CLOSE",
  "BRACE_CLOSE",
  "PERIOD",
  "COLON",
]);
const NO_SPACE_AFTER = new Set<TokenKind>([
  "PARENTHESIS_OPEN",
  "BRACKET_OPEN",
  "BRACE_OPEN",
  "PERIOD",
  "DOLLAR",
]);
const CALLEES = new Set<TokenKind>([
  "IDENTIFIER",
  "ANNOTATION",
  "LITERAL",
  "PARENTHESIS_CLOSE",
  "BRACKET_CLOSE",
  "SELF",
  "SUPER",
  "PRELOAD",
  "ASSERT",
]); // 后接 `(` 或 `[` 时是调用或下标，紧贴书写。
/** 常量按 GDScript 字面量书写，字符串转义沿用 JSON 的子集。 */
function print_literal(v: Value): string {
  if (v.type === 4) return JSON.stringify(v.value);
  if (v.type === 21) return "&" + JSON.stringify(v.value);
  if (v.type === 22) return "^" + JSON.stringify(v.value);
  if (v.type === 3 && Number.isInteger(v.value)) return Number(v.value).toFixed(1);
  return String(v.value ?? "null");
}
/**
 * 按原行号还原可读源码，供调查语境和搜索使用，不追求逐字还原，注释在编译时已丢失。
 * 逻辑行首个 token 按列号用空格缩进，词法器已把 tab 按 `tab_size` 计入列号。编译时不保存换行与缩进 token。
 */
export function print_gdsc(g: Gdsc): string {
  const lines: string[] = [];
  let line = 0,
    indent = 0,
    previous: Token | undefined,
    path = false; // `$` 节点路径中的标识符和 `/` 紧贴书写。
  for (const t of g.tokens) {
    const column = g.columns.get(t.index);
    if (column !== undefined) indent = column - 1;
    const text =
      t.kind === "ANNOTATION" || t.kind === "IDENTIFIER"
        ? g.identifiers[t.reference]!
        : t.kind === "LITERAL"
          ? print_literal(g.constants[t.reference]!)
          : (SYMBOLS[t.kind] ??
            (t.kind.startsWith("CONST_") ? t.kind.slice(6) : t.kind.toLowerCase()));
    if (!previous || t.line > line) {
      line = Math.max(line, t.line);
      lines[line - 1] =
        " ".repeat(column === undefined && previous ? indent + CONTINUATION_INDENT : indent) + text;
      path = t.kind === "DOLLAR";
    } else {
      path =
        previous.kind === "DOLLAR" ||
        (path && (t.kind === "SLASH" || (previous.kind === "SLASH" && t.kind === "IDENTIFIER")));
      const glued =
        path ||
        NO_SPACE_BEFORE.has(t.kind) ||
        NO_SPACE_AFTER.has(previous.kind) ||
        (previous.kind === "COLON" && t.kind === "EQUAL") || // `:=`
        ((t.kind === "PARENTHESIS_OPEN" || t.kind === "BRACKET_OPEN") &&
          CALLEES.has(previous.kind));
      lines[line - 1] += (glued ? "" : " ") + text;
    }
    previous = t;
  }
  return Array.from(lines, (text) => text ?? "").join("\n") + "\n";
}
// 同文常量可能同时作为逻辑键和显示文本，按 token 引用追加常量，保留其余引用。
export function patch_gdsc(
  bytes: Buffer,
  changes: ReadonlyMap<number, { original: string; text: string }>,
): Buffer {
  if (!changes.size) return bytes;
  const g = read_gdsc(bytes),
    appended: Buffer[] = [],
    edits = [];
  let count = g.constants.length;
  for (const [index, change] of changes) {
    const t = g.tokens[index];
    assert(t && t.kind === "LITERAL", "Not a literal token");
    assert.equal(g.constants[t.reference]!.value, change.original, "Stale literal");
    assert(count < 0x1000000);
    appended.push(variant_string(change.text));
    edits.push({
      start: t.start,
      end: t.end,
      bytes: Buffer.concat([u32((count++ << 8) | 0x83), u32(t.line)]),
    });
  }
  edits.push(
    { start: 4, end: 8, bytes: u32(count) },
    { start: g.constantsEnd, end: g.constantsEnd, bytes: Buffer.concat(appended) },
  );
  const body = splice(g.body, edits);
  return Buffer.concat([
    Buffer.from("GDSC"),
    u32(g.version),
    u32(body.length),
    zstdCompressSync(body),
  ]);
}
