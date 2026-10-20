import assert from "node:assert/strict";
import { zstdDecompressSync, zstdCompressSync } from "node:zlib";
import { Reader, GODOT_RESOURCE_MAX_BYTES, u32, splice } from "./binary";
import { read_variant, variant_string, type Value } from "./variant";
export type Token = {
  index: number;
  start: number;
  end: number;
  type: number;
  reference: number;
  line: number;
};
/** GDSC 100 与 101 使用不同头长，共享常量与 token 引用分别解析。 */
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
  r.take(lineCount * 16);
  const tokens: Token[] = [];
  for (let i = 0; i < tokenCount; i++) {
    const start = r.at,
      wide = !!(body[start]! & 0x80),
      code = wide ? r.u32() : r.take(1)[0]!,
      type = code & 0x7f,
      reference = code >>> 8,
      line = r.u32();
    assert(type < (version === 100 ? 99 : 100), "Invalid token kind");
    if (type === 1 || type === 2) assert(reference < identifiers.length);
    if (type === 3) assert(reference < constants.length);
    tokens.push({ index: i, start, end: r.at, type, reference, line });
  }
  assert.equal(r.at, body.length, "GDC trailing data");
  return { version, body, identifiers, constants, constantsEnd, tokens };
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
    assert(t && t.type === 3, "Not a literal token");
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
