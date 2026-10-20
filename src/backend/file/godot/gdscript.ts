import assert from "node:assert/strict";
/** 源码坐标采用 JavaScript 字符串索引，始终绑定固化原稿。 */
export type Literal = { start: number; end: number; text: string; qualifier: string };
/** 扫描时跳过注释，按 GDScript 规则解释 raw、三引号和类型限定字面量。 */
export function read_source(source: string): Literal[] {
  const values: Literal[] = [];
  let at = 0;
  while (at < source.length) {
    const c = source[at]!;
    if (c === "#") {
      while (at < source.length && source[at] !== "\n") at++;
      continue;
    }
    let raw = false,
      start = at;
    if (
      c === "r" &&
      (source[at + 1] === '"' || source[at + 1] === "'") &&
      !/[\p{L}\p{N}_]/u.test(source[at - 1] ?? "")
    ) {
      raw = true;
      at++;
    }
    const quote = source[at];
    if (quote !== '"' && quote !== "'") {
      at++;
      continue;
    }
    const triple = source.slice(at, at + 3) === quote.repeat(3),
      delimiter = quote.repeat(triple ? 3 : 1);
    at += delimiter.length;
    let text = "",
      closed = false;
    while (at < source.length) {
      if (source.slice(at, at + delimiter.length) === delimiter) {
        at += delimiter.length;
        closed = true;
        break;
      }
      const ch = source[at++]!;
      if (ch === "\n") assert(triple, "Unterminated single-line literal");
      if (ch === "\\") {
        assert(at < source.length);
        const next = source[at++]!;
        if (raw) {
          text += "\\" + next;
          continue;
        }
        if (next === "\n") continue;
        if (next === "u" || next === "U") {
          const n = next === "u" ? 4 : 8,
            hex = source.slice(at, at + n);
          assert(new RegExp("^[0-9a-fA-F]{" + n + "}$", "u").test(hex));
          const cp = parseInt(hex, 16);
          assert(cp <= 0x10ffff);
          text += String.fromCodePoint(cp);
          at += n;
          continue;
        }
        const escape: Record<string, string> = {
          a: "\x07",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
          v: "\v",
          "\\": "\\",
          '"': '"',
          "'": "'",
        };
        assert(next in escape, "Unknown GDScript escape");
        text += escape[next];
      } else text += ch;
    }
    assert(closed, "Unterminated source literal");
    const qualifier = /[&^$]/u.test(source[start - 1] ?? "") ? source[start - 1]! : "";
    values.push({ start, end: at, text, qualifier });
  }
  return values;
}
/** 只替换指定原稿区间，同文引用各自保留，类型限定字符串交由代码持有。 */
export function patch_source(
  source: string,
  changes: ReadonlyMap<number, { end: number; original: string; text: string }>,
): string {
  const literals = new Map(read_source(source).map((value) => [value.start, value])),
    edits = [...changes]
      .map(([start, c]) => {
        const v = literals.get(start);
        assert(v && !v.qualifier, "Not a display string literal");
        assert.equal(v.end, c.end, "Stale Godot source span");
        assert.equal(v.text, c.original, "Stale source");
        return { ...v, newText: JSON.stringify(c.text) };
      })
      .sort((a, b) => b.start - a.start);
  for (const e of edits) source = source.slice(0, e.start) + e.newText + source.slice(e.end);
  return source;
}
