// LZ4 block format: WolfTL bfc38fc2735ab4f7f7ddbec8d57b7fef65f0712f / 3rdParty/lz4.
import assert from "node:assert/strict";

export const WOLF_MAX_DATA_BYTES = 256 * 1024 * 1024; // 单成员解码上限，限制损坏长度造成的整块分配。
const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MATCH_FIND_LIMIT = 12;
const HASH_BITS = 16;

/** 有界 LZ4 块解码，重叠匹配必须逐字节复制。 */
export function decompress_lz4(src: Uint8Array, size: number): Buffer {
  assert(
    Number.isSafeInteger(size) && size >= 0 && size <= WOLF_MAX_DATA_BYTES,
    "Invalid LZ4 size",
  );
  const out = Buffer.alloc(size);
  let at = 0,
    pos = 0;
  /** 读取 token 溢出的长度字节，连续 255 表示继续累加。 */
  const length = (value: number): number => {
    if (value === 15) {
      let extra: number;
      do {
        assert(at < src.length, "Truncated LZ4 length");
        extra = src[at++]!;
        value += extra;
      } while (extra === 255);
    }
    return value;
  };
  while (at < src.length) {
    const token = src[at++]!,
      literals = length(token >>> 4);
    assert(at + literals <= src.length && pos + literals <= size, "Invalid LZ4 literals");
    out.set(src.subarray(at, at + literals), pos);
    at += literals;
    pos += literals;
    if (at === src.length) break;
    assert(at + 2 <= src.length, "Truncated LZ4 offset");
    const back = src[at++]! | (src[at++]! << 8);
    const count = length(token & 15) + MIN_MATCH;
    assert(back > 0 && back <= pos && pos + count <= size, "Invalid LZ4 match");
    for (let i = 0; i < count; i++, pos++) out[pos] = out[pos - back]!;
  }
  assert.equal(pos, size, "LZ4 output size mismatch");
  return out;
}

/** 贪心哈希匹配生成标准块，末尾保留规范要求的 literal 区域。 */
export function compress_lz4(input: Uint8Array): Buffer {
  assert(input.length <= WOLF_MAX_DATA_BYTES, "Invalid LZ4 size");
  const src = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const out = Buffer.alloc(src.length + Math.floor(src.length / 255) + 16);
  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  let at = 0,
    anchor = 0,
    pos = 0;
  /** 将溢出长度编码为连续扩展字节。 */
  const extra = (size: number): void => {
    while (size >= 255) {
      out[pos++] = 255;
      size -= 255;
    }
    out[pos++] = size;
  };
  /** 输出一个 literal 与可选回溯匹配组成的序列。 */
  const emit = (end: number, back: number, match: number): void => {
    const literals = end - anchor;
    out[pos++] = (Math.min(literals, 15) << 4) | Math.min(match ? match - MIN_MATCH : 0, 15);
    if (literals >= 15) extra(literals - 15);
    src.copy(out, pos, anchor, end);
    pos += literals;
    if (match) {
      out.writeUInt16LE(back, pos);
      pos += 2;
      if (match - MIN_MATCH >= 15) extra(match - MIN_MATCH - 15);
    }
  };
  while (at <= src.length - MATCH_FIND_LIMIT) {
    const word = src.readUInt32LE(at);
    const hash = Math.imul(word, 2654435761) >>> (32 - HASH_BITS);
    const previous = table[hash]!;
    table[hash] = at;
    if (previous < 0 || at - previous > 65535 || src.readUInt32LE(previous) !== word) {
      at++;
      continue;
    }
    let count = MIN_MATCH;
    while (at + count < src.length - LAST_LITERALS && src[previous + count] === src[at + count])
      count++;
    emit(at, at - previous, count);
    at += count;
    anchor = at;
  }
  emit(src.length, 0, 0);
  return out.subarray(0, pos);
}
