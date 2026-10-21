import assert from "node:assert/strict";
import {
  zstdDecompressSync,
  zstdCompressSync,
  inflateSync,
  gunzipSync,
  brotliDecompressSync,
} from "node:zlib";
import {
  Reader,
  GODOT_RESOURCE_MAX_BYTES,
  pad,
  string,
  u32,
  u64,
  utf8,
  splice,
  type Edit,
} from "./binary";
import { node_path, type Value } from "./variant";
import { fastlz_decode } from "./fastlz";

/** RSCC 按块解压，每块产出长度与声明一致后才合并。 */
export function decode_resource(bytes: Buffer): {
  body: Buffer;
  compressed: boolean;
  origin: number;
} {
  const magic = bytes.toString("ascii", 0, 4);
  if (magic === "RSRC") return { body: bytes.subarray(4), compressed: false, origin: 4 };
  assert(magic === "RSCC", "Not a binary resource");
  const r = new Reader(bytes);
  r.at = 4;
  const mode = r.u32(),
    block = r.u32(),
    size = r.u32();
  assert(block > 0 && block <= GODOT_RESOURCE_MAX_BYTES && size <= GODOT_RESOURCE_MAX_BYTES);
  const n = Math.floor(size / block) + 1,
    sizes: number[] = [];
  assert(n <= 1000000);
  for (let i = 0; i < n; i++) sizes.push(r.u32());
  const chunks: Buffer[] = [];
  for (let i = 0; i < n; i++)
    chunks.push(decode_block(mode, r.take(sizes[i]!), i === n - 1 ? size % block : block));
  assert(r.take(4).toString() === "RSCC");
  assert.equal(r.at, bytes.length);
  return { body: Buffer.concat(chunks), compressed: true, origin: 0 };
}
/** 单块解压结果须与声明长度一致。 */
function decode_block(mode: number, b: Buffer, expected: number): Buffer {
  let out: Buffer;
  if (mode === 0) out = fastlz_decode(b, Math.max(expected, 16)).subarray(0, expected); // Godot 把不足 16 字节的 FastLZ 输入补至 16。
  else if (mode === 2) out = zstdDecompressSync(b, { maxOutputLength: GODOT_RESOURCE_MAX_BYTES });
  else if (mode === 1) out = inflateSync(b, { maxOutputLength: GODOT_RESOURCE_MAX_BYTES });
  else if (mode === 3) out = gunzipSync(b, { maxOutputLength: GODOT_RESOURCE_MAX_BYTES });
  else if (mode === 4)
    out = brotliDecompressSync(b, {
      maxOutputLength: GODOT_RESOURCE_MAX_BYTES,
    });
  else throw Error("Unsupported compression mode " + mode);
  assert.equal(out.length, expected);
  return out;
}
const RESOURCE_TYPE_PREFIX_BYTES = 1024; // 头部 20 字节后紧跟顶层类名，类名远短于该长度。
/** 候选筛选只读到顶层类名，避免为判断类型把大资源整体读入内存。 */
export function read_resource_type(read_prefix: (length: number) => Buffer): string {
  const header = read_prefix(16);
  let body: Buffer;
  if (header.toString("ascii", 0, 4) === "RSRC")
    body = read_prefix(4 + RESOURCE_TYPE_PREFIX_BYTES).subarray(4);
  else {
    assert(
      header.length === 16 && header.toString("ascii", 0, 4) === "RSCC",
      "Not a binary resource",
    );
    const mode = header.readUInt32LE(4),
      block = header.readUInt32LE(8),
      size = header.readUInt32LE(12);
    assert(block > 0 && block <= GODOT_RESOURCE_MAX_BYTES && size <= GODOT_RESOURCE_MAX_BYTES);
    const n = Math.floor(size / block) + 1,
      sizes_end = 16 + n * 4;
    assert(n <= 1000000);
    const sizes = read_prefix(sizes_end);
    assert.equal(sizes.length, sizes_end, "Truncated RSCC block table");
    const first = read_prefix(sizes_end + sizes.readUInt32LE(16));
    assert.equal(first.length, sizes_end + sizes.readUInt32LE(16), "Truncated RSCC block");
    body = decode_block(mode, first.subarray(sizes_end), n === 1 ? size % block : block);
  }
  const reader = new Reader(body);
  reader.take(20);
  return reader.string(true);
}
/** 改写后的压缩资源统一用 Godot 支持的 Zstandard 分块编码。 */
export function encode_resource(body: Buffer, compressed: boolean): Buffer {
  if (!compressed) return Buffer.concat([Buffer.from("RSRC"), body]);
  const block = 65536,
    n = Math.floor(body.length / block) + 1,
    blocks: Buffer[] = [];
  for (let i = 0; i < n; i++)
    blocks.push(zstdCompressSync(body.subarray(i * block, Math.min((i + 1) * block, body.length))));
  return Buffer.concat([
    Buffer.from("RSCC"),
    u32(2),
    u32(block),
    u32(body.length),
    ...blocks.map((b) => u32(b.length)),
    ...blocks,
    Buffer.from("RSCC"),
  ]);
}
/** 资源文件自有编号，与 Marshal 的 `Variant::Type` 不同。 */
export const RESOURCE_VARIANT_TYPES: Readonly<Record<number, string>> = {
  1: "NIL",
  2: "BOOL",
  3: "INT",
  4: "FLOAT",
  5: "STRING",
  10: "VECTOR2",
  11: "RECT2",
  12: "VECTOR3",
  13: "PLANE",
  14: "QUATERNION",
  15: "AABB",
  16: "BASIS",
  17: "TRANSFORM3D",
  18: "TRANSFORM2D",
  20: "COLOR",
  22: "NODE_PATH",
  23: "RID",
  24: "OBJECT",
  25: "INPUT_EVENT",
  26: "DICTIONARY",
  30: "ARRAY",
  31: "PACKED_BYTE_ARRAY",
  32: "PACKED_INT32_ARRAY",
  33: "PACKED_FLOAT32_ARRAY",
  34: "PACKED_STRING_ARRAY",
  35: "PACKED_VECTOR3_ARRAY",
  36: "PACKED_COLOR_ARRAY",
  37: "PACKED_VECTOR2_ARRAY",
  40: "INT",
  41: "FLOAT",
  42: "CALLABLE",
  43: "SIGNAL",
  44: "STRING_NAME",
  45: "VECTOR2I",
  46: "RECT2I",
  47: "VECTOR3I",
  48: "PACKED_INT64_ARRAY",
  49: "PACKED_FLOAT64_ARRAY",
  50: "VECTOR4",
  51: "VECTOR4I",
  52: "PROJECTION",
  53: "PACKED_VECTOR4_ARRAY",
};
const FORMAT_FLAG_NAMED_SCENE_IDS = 1; // 资源头标志：内部资源引用直接保存内部表下标。

export type Property = {
  resource: number;
  className: string;
  name: string;
  value: Value;
};
/** 单次成员处理共用原字节与解码坐标，无修改时保留原编码。 */
export type ResourceDocument = Readonly<{
  bytes: Buffer;
  body: Buffer;
  compressed: boolean;
  origin: number;
  type: string;
  external: { type: string; path: string }[];
  internal: readonly { path: string; offset: number; at: number; className: string }[];
  metadataAt: number;
  metadata: number;
  properties: readonly Property[];
}>;
/** 资源 Variant 坐标相对解压体，内部指针按文件是否压缩转换原点。 */
export function read_resource(bytes: Buffer): ResourceDocument {
  const decoded = decode_resource(bytes),
    { body, origin } = decoded,
    r = new Reader(body);
  assert.equal(r.u32(), 0, "Big endian resource needs separate capability");
  r.u32();
  const major = r.u32();
  r.u32(); // 次版本不改变这里使用的资源协议。
  const version = r.u32();
  assert(major === 4 && version >= 3 && version <= 6);
  const type = r.string(true),
    metadataAt = r.at,
    metadata = r.u64(),
    flags = r.u32();
  r.take(8);
  if (flags & 8) r.string(true);
  r.take(11 * 4);
  const real = flags & 4 ? 8 : 4,
    strings: string[] = [];
  for (let i = 0, n = r.count(); i < n; i++) strings.push(r.string(true));
  const external: { type: string; path: string }[] = []; // 由游戏加载器持有，只读。
  for (let i = 0, n = r.count(); i < n; i++) {
    external.push({ type: r.string(true), path: r.string(true) });
    if (flags & 2) r.take(8);
  }
  const internal: { path: string; offset: number; at: number; className: string }[] = [];
  for (let i = 0, n = r.count(); i < n; i++) {
    const p = r.string(true),
      at = r.at,
      offset = r.u64();
    internal.push({ path: p, offset, at, className: "" });
  }
  const tableEnd = r.at;
  const properties: Property[] = [];
  /** 字符串名称可以内联编码，也可以引用文档的字符串表。 */
  const name = (): string => {
    const id = r.u32();
    if (id & 0x80000000) return utf8.decode(r.take(id & 0x7fffffff)).replace(/\0$/u, "");
    assert(id < strings.length);
    return strings[id]!;
  };
  /** 读取资源 Variant，并保留后续定点写回所需的解压体坐标。 */
  const variant = (depth = 0): Value => {
    assert(depth < 64);
    const start = r.at,
      t = r.u32();
    let value: Value["value"];
    let children: Value[] | undefined, length: number | undefined, ref: Value["ref"];
    if (t === 1) value = null;
    else if (t === 2) value = !!r.u32();
    else if (t === 3) value = r.take(4).readInt32LE();
    else if (t === 40) value = Number(r.take(8).readBigInt64LE());
    else if (t === 4) {
      const b = r.take(real);
      value = real === 8 ? b.readDoubleLE() : b.readFloatLE();
    } else if (t === 41) value = r.take(8).readDoubleLE();
    else if (t === 5 || t === 44) value = r.string(true);
    else if (t === 22) {
      const a = r.take(2).readUInt16LE(),
        b = r.take(2).readUInt16LE(),
        parts: string[] = [];
      for (let i = 0; i < a + (b & 0x7fff); i++) parts.push(name());
      value = node_path(parts.slice(0, a), parts.slice(a), !!(b & 0x8000));
    } else if (t === 23) r.take(4);
    else if (t === 24) {
      const kind = r.u32();
      if (kind === 1) {
        r.string(true); // 旧格式直接给出外部资源类型与路径。
        ref = { external: r.string(true) };
      } else if (kind === 2) {
        const id = r.u32();
        // Godot 命名 ID 格式直接存表下标，旧格式按 local://<整数 ID> 定位。
        const index =
          flags & FORMAT_FLAG_NAMED_SCENE_IDS
            ? id
            : internal.findIndex((entry) => entry.path === `local://${id}`);
        assert(index >= 0 && index < internal.length, "Invalid internal resource reference: " + id);
        ref = { internal: index };
      } else if (kind === 3) {
        const path = external[r.u32()]?.path;
        if (path !== undefined) ref = { external: path }; // 越界下标由 Godot 按断开的依赖加载为空。
      } else assert(kind === 0);
    } else if (t === 42 || t === 43) {
    } else if (t === 26 || t === 30) {
      const count = r.count() * (t === 26 ? 2 : 1);
      children = [];
      for (let i = 0; i < count; i++) children.push(variant(depth + 1));
    } else if (t === 34) {
      const n = r.count();
      children = [];
      for (let i = 0; i < n; i++) {
        const at = r.at,
          s = r.string(true);
        children.push({
          type: 5,
          start: at,
          end: r.at,
          value: s,
          encoding: "resource_string",
        });
      }
    } else if ([31, 32, 33, 35, 36, 37, 48, 49, 53].includes(t)) {
      const n = r.u32(),
        widths: Record<number, number> = {
          31: 1,
          32: 4,
          33: 4,
          35: real * 3,
          36: 16,
          37: real * 2,
          48: 8,
          49: 8,
          53: real * 4,
        };
      assert(n * widths[t]! <= GODOT_RESOURCE_MAX_BYTES);
      value = r.take(n * widths[t]!);
      length = n;
      if (t === 31) r.take(pad(n));
    } else {
      const widths: Record<number, number> = {
        10: real * 2,
        11: real * 4,
        12: real * 3,
        13: real * 4,
        14: real * 4,
        15: real * 6,
        16: real * 9,
        17: real * 12,
        18: real * 6,
        20: 16,
        45: 8,
        46: 16,
        47: 12,
        50: real * 4,
        51: 16,
        52: real * 16,
      };
      assert(widths[t], "Unknown resource variant " + t);
      r.take(widths[t]!);
    }
    return {
      type: t,
      start,
      end: r.at,
      ...(value === undefined ? {} : { value }),
      ...(children === undefined ? {} : { children }),
      ...(length === undefined ? {} : { length }),
      ...(ref === undefined ? {} : { ref }),
    };
  };
  for (let i = 0; i < internal.length; i++) {
    const entry = internal[i]!;
    r.at = entry.offset - origin;
    assert(r.at >= tableEnd && r.at < body.length);
    const className = r.string(true),
      count = r.count();
    entry.className = className;
    for (let j = 0; j < count; j++) {
      const key = name(),
        v = variant();
      properties.push({ resource: i, className, name: key, value: v });
    }
    const next = internal[i + 1]?.offset;
    if (next !== undefined) assert(r.at <= next - origin, "Resource overlaps next");
  }
  return {
    bytes,
    ...decoded,
    type,
    external,
    internal,
    metadataAt,
    metadata,
    properties,
  };
}
/** 按原稿区间写回，同时修正后续内部资源与元数据指针。 */
export function patch_resource(doc: ResourceDocument, edits: readonly Edit[]): Buffer {
  if (!edits.length) return doc.bytes;
  const pointerEdits: Edit[] = [];
  /** 内部资源指针按其前方 edits 的长度变化调整。 */
  const moved = (offset: number) =>
    offset +
    edits.reduce(
      (n, e) => n + (e.end <= offset - doc.origin ? e.bytes.length - (e.end - e.start) : 0),
      0,
    );
  for (const ir of doc.internal)
    pointerEdits.push({
      start: ir.at,
      end: ir.at + 8,
      bytes: u64(moved(ir.offset)),
    });
  if (doc.metadata)
    pointerEdits.push({
      start: doc.metadataAt,
      end: doc.metadataAt + 8,
      bytes: u64(moved(doc.metadata)),
    });
  return encode_resource(splice(doc.body, [...edits, ...pointerEdits]), doc.compressed);
}
/** 资源 String 使用类型号 `5`，长度包含末尾 NUL。 */
export const resource_string = (s: string): Buffer => Buffer.concat([u32(5), string(s, true)]);
