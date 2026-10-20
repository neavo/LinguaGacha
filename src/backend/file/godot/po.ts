import assert from "node:assert/strict";
import { read_source } from "./gdscript";
export type PoField = { kind: string; index: number; start: number; end: number; text: string };
/** 多行字段合并为一个原稿区间，复数索引独立保留。 */
export function read_po(source: string): PoField[] {
  const fields: PoField[] = [];
  let at = 0,
    current: PoField | undefined;
  for (const line of source.match(/[^\n]*(?:\n|$)/gu) ?? []) {
    if (!line) continue;
    const field = /^\s*(msgctxt|msgid_plural|msgid|msgstr)(?:\[(\d+)\])?\s+(".*")\s*$/u.exec(
      line.trimEnd(),
    );
    const continuation = /^\s*(".*")\s*$/u.exec(line.trimEnd());
    if (field) {
      const values = read_source(field[3]!);
      assert(values.length === 1);
      current = {
        kind: field[1]!,
        index: field[2] === undefined ? 0 : Number(field[2]),
        start: at,
        end: at + line.length,
        text: values[0]!.text,
      };
      fields.push(current);
    } else if (continuation) {
      assert(current, "Orphan PO continuation");
      const values = read_source(continuation[1]!);
      assert(values.length === 1);
      current.text += values[0]!.text;
      current.end = at + line.length;
    } else {
      assert(!line.trim() || line.trimStart().startsWith("#"), "Unsupported PO syntax");
      current = undefined;
    }
    at += line.length;
  }
  return fields;
}
/** 仅重写指定 msgstr 区间，注释、上下文和其它复数槽位保持原字节。 */
export function patch_po(
  source: string,
  changes: ReadonlyMap<number, { end: number; original: string; text: string }>,
): string {
  const fields = new Map(read_po(source).map((field) => [field.start, field])),
    edits = [...changes]
      .map(([at, c]) => {
        const f = fields.get(at);
        assert(f && f.kind === "msgstr", "Not a PO translation");
        assert.equal(f.end, c.end, "Stale Godot PO span");
        assert.equal(f.text, c.original);
        const isPlural = /^\s*msgstr\[/u.test(source.slice(f.start, f.end));
        return {
          ...f,
          text: `msgstr${isPlural ? "[" + f.index + "]" : ""} ${JSON.stringify(c.text)}\n`,
        };
      })
      .sort((a, b) => b.start - a.start);
  for (const e of edits) source = source.slice(0, e.start) + e.text + source.slice(e.end);
  return source;
}
