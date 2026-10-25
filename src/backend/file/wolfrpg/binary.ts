import assert from "node:assert/strict";
import iconv from "iconv-lite";
import { compress_lz4, decompress_lz4, WOLF_MAX_DATA_BYTES } from "./lz4";
import type { WolfLocation } from "./item";

export type WolfByteRange = Readonly<{ start: number; end: number }>;
type WolfDescription = WolfByteRange & Readonly<{ text: string }>;

/** 字节区间仅属于本次解析，持久定位由 `location` 保存。 */
export type WolfSlot = WolfByteRange &
  Readonly<{
    text: string;
    location: WolfLocation;
    usage: "text" | "metadata";
    context: string;
  }>;
const MAX_COUNT = 1000000; // 计数字段上限，拒绝损坏长度造成的超大分配。
/** 未识别协议必须在目录提交前拒绝，与可保留原稿的成员解析失败分开。 */
export class WolfProtocolError extends Error {}
export type WolfDocument = {
  original: Uint8Array; // 无译文时直接返回固化原稿。
  bytes: Buffer;
  utf8: boolean;
  compression: number | null; // LZ4 封装前的头部长度，`null` 表示散装数据。
  slots: WolfSlot[];
  details: unknown;
  descriptions?: readonly WolfDescription[];
  offsets?: readonly number[]; // `Game.dat` 中随字符串总长度变化的长度与偏移字段。
};

/** 读取边界先验证再推进，未知区域保留在同一字节缓冲区。 */
export class WolfReader {
  public readonly slots: WolfSlot[] = [];
  public readonly descriptions: WolfDescription[] = [];
  /** 固定当前文件的字节、游标和编码。 */
  public constructor(
    public readonly bytes: Buffer,
    public at = 0,
    public readonly utf8 = true,
  ) {}
  /** 取得有界区间并推进游标。 */
  public take(size: number): Buffer {
    assert(
      Number.isSafeInteger(size) && size >= 0 && this.at + size <= this.bytes.length,
      "Truncated WOLF data at " + this.at + ": " + size,
    );
    const start = this.at;
    this.at += size;
    return this.bytes.subarray(start, this.at);
  }
  /** 读取一个字节的标记或参数数量。 */
  public byte(): number {
    return this.take(1)[0]!;
  }
  /** 读取小端无符号 32 位字段。 */
  public uint(): number {
    return this.take(4).readUInt32LE();
  }
  /** 限制外部计数，避免损坏文件驱动无界遍历。 */
  public count(): number {
    const size = this.uint();
    assert(size <= MAX_COUNT, "Invalid WOLF count: " + size);
    return size;
  }
  /** 读取并核对当前位置的结构标记。 */
  public expect(value: number): void {
    assert.equal(this.byte(), value, "Unsupported WOLF marker at " + (this.at - 1));
  }
  /** 按长度和末尾零字节读取字符串，已知位置才登记可编辑槽位。 */
  public string(
    location?: WolfLocation,
    usage: WolfSlot["usage"] = "metadata",
    context = "",
  ): string {
    const start = this.at;
    const text = this.read_string();
    assert(!text.includes("\0"), "Embedded WOLF string terminator");
    if (location) this.slots.push({ start, end: this.at, text, location, usage, context });
    return text;
  }
  /** 说明允许内部 C0。字节区间供准备阶段清理，不参与翻译定位。 */
  public description(): string {
    const start = this.at,
      text = this.read_string();
    this.descriptions.push({ start, end: this.at, text });
    return text;
  }
  /** 普通字符串和说明共用长度、终止符与编码校验。 */
  private read_string(): string {
    const size = this.uint();
    assert(size >= 1, "Invalid WOLF string length");
    const bytes = this.take(size);
    assert.equal(bytes[size - 1], 0, "Unterminated WOLF string");
    return new TextDecoder(this.utf8 ? "utf-8" : "shift-jis", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(0, -1));
  }
  /** 要求完整消费布局，避免遗漏未知尾部。 */
  public done(): void {
    assert.equal(this.at, this.bytes.length, "Unexpected WOLF trailing data");
  }
}

/** 准备层已移除归档提示，原稿解析只接受引擎可读取的数据头与压缩封装。 */
export function open_wolf_document(
  input: Uint8Array,
  magic: readonly number[],
  encoding_at: number,
  version_at: number | null,
  versions: readonly number[],
  compressed: readonly number[],
  header_size: number,
): WolfDocument {
  let bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  assert(
    bytes.length >= header_size && bytes.length <= WOLF_MAX_DATA_BYTES,
    "Invalid WOLF data length",
  );
  if (
    !magic.every((byte, index) =>
      index === encoding_at ? bytes[index] === 0 || bytes[index] === 0x55 : bytes[index] === byte,
    )
  )
    throw new WolfProtocolError(
      "Unsupported WOLF data header/protection: " + bytes.subarray(0, header_size).toString("hex"),
    );
  const version = version_at === null ? null : bytes[version_at]!;
  if (version !== null && !versions.includes(version))
    throw new WolfProtocolError("Unsupported WOLF data marker: " + version.toString(16));
  const compression = version !== null && compressed.includes(version) ? header_size : null;
  if (compression !== null) {
    const reader = new WolfReader(bytes, compression),
      size = reader.uint(),
      packed = reader.uint();
    const content = reader.take(packed);
    reader.done();
    bytes = Buffer.concat([bytes.subarray(0, compression), decompress_lz4(content, size)]);
  }
  return {
    original: input,
    bytes,
    utf8: bytes[encoding_at] === 0x55,
    compression,
    slots: [],
    details: null,
  };
}

/** 编码后往返核对原文，拒绝 CP932 无法表示的字符及隐式替换。 */
export function encode_wolf_string(text: string, utf8: boolean): Buffer {
  assert(text.isWellFormed() && !text.includes("\0"), "Invalid WOLF translation string");
  const bytes = utf8 ? Buffer.from(text, "utf8") : iconv.encode(text, "cp932");
  assert(
    utf8 || iconv.decode(bytes, "cp932") === text,
    "WOLF translation cannot be encoded as CP932",
  );
  const result = Buffer.alloc(4 + bytes.length + 1);
  result.writeUInt32LE(bytes.length + 1);
  bytes.copy(result, 4);
  return result;
}

/** 区间替换保留未知字节，随后更新 Game.dat 偏移并恢复原封装。 */
export function replace_wolf_slots(
  document: WolfDocument,
  edits: ReadonlyMap<WolfByteRange, string>,
): Uint8Array {
  if (!edits.size) return document.original;
  const sorted = [...edits].sort(([a], [b]) => a.start - b.start),
    parts: Buffer[] = [];
  let at = 0,
    delta = 0;
  for (const [slot, text] of sorted) {
    assert(slot.start >= at && slot.end <= document.bytes.length, "Overlapping WOLF edits");
    const replacement = encode_wolf_string(text, document.utf8);
    parts.push(document.bytes.subarray(at, slot.start), replacement);
    at = slot.end;
    delta += replacement.length - (slot.end - slot.start);
  }
  parts.push(document.bytes.subarray(at));
  let bytes = Buffer.concat(parts);
  for (const offset of document.offsets ?? []) {
    assert(offset >= at, "Invalid WOLF internal offset location");
    const value = document.bytes.readUInt32LE(offset) + delta;
    assert(value >= 0 && value <= 0xffffffff, "WOLF offset overflow");
    bytes.writeUInt32LE(value, offset + delta);
  }
  if (document.compression !== null) {
    const body = bytes.subarray(document.compression),
      packed = compress_lz4(body),
      sizes = Buffer.alloc(8);
    sizes.writeUInt32LE(body.length);
    sizes.writeUInt32LE(packed.length, 4);
    bytes = Buffer.concat([bytes.subarray(0, document.compression), sizes, packed]);
  }
  return bytes;
}

/** 仅清理解析器声明的说明字段，保留 LF、CR 和其它字段的原始字节。 */
export function normalize_wolf_descriptions(document: WolfDocument): Uint8Array {
  const edits = new Map<WolfByteRange, string>();
  for (const field of document.descriptions ?? []) {
    const text = [...field.text]
      .filter(
        (character) => character.charCodeAt(0) >= 32 || character === "\n" || character === "\r",
      )
      .join("");
    if (text !== field.text) edits.set(field, text);
  }
  return replace_wolf_slots(document, edits);
}
