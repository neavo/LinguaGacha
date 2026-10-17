/*!
 *  Copyright (c) 2024-2026 Sinflower
 *
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 *
 */
// Port of UberWolf f4191375d289171b1f29dbc5ca320133b2b4b96a.
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  BINARY_CHUNK_BYTES,
  read_bytes,
  write_bytes,
  type BinaryFileHandle,
} from "../shared/binary";
import type { WolfXCandidates } from "./key-collector";

const STREAM_BYTES = 256, // 正文按该周期循环异或。
  STATIC_BYTES = 64, // 主密钥折叠后的静态块长度。
  HEADER_BYTES = 20;
// 头部变量编号达到上限时表示该层不参与密钥，候选取默认值。
const NO_STRING = 10000,
  NO_INTEGER = 1000000;
/** 正文区间与已派生的周期密钥流。 */
export type WolfXMatch = Readonly<{
  offset: number;
  length: number;
  stream: Uint8Array;
}>;

/** 引擎按 UTF-16 码元编码 CESU-8，补充平面字符必须保留两个代理码元。 */
export function encode_wolfx_key(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Buffer.from(bytes);
}
/** 32 位 FNV-1a 摘要。 */
function fnv(bytes: Uint8Array): number {
  let value = 0x811c9dc5;
  for (const byte of bytes) value = Math.imul(value ^ byte, 0x1000193) >>> 0;
  return value;
}
/** 主密钥折叠为非零静态块，决定正文偏移与流种子。 */
function static_blob(key: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(STATIC_BYTES).fill(0xaa);
  let dynamic = 0xbe;
  for (let i = 0; i < key.length; i++) {
    const j = i % STATIC_BYTES;
    bytes[j]! ^= key[i]!;
    bytes[j]! += dynamic;
    bytes[j] = (bytes[j]! << 3) | (bytes[j]! >>> 5);
    dynamic = (key[i]! ^ Math.imul(0xb3, dynamic)) & 255;
  }
  for (let round = 0; round < 5; round++)
    for (let j = 0; j < STATIC_BYTES; j++) {
      const value =
        (bytes[(j + 13) % STATIC_BYTES]! + (bytes[j]! ^ bytes[(j + 7) % STATIC_BYTES]!)) & 255;
      bytes[j] = (value >>> 7) | (value << 1);
    }
  return bytes.map((byte) => byte || 1);
}

/** 相同密文上比较全部可能用到的周期字节，避免为同文去重读取整份素材。 */
function same_output(left: WolfXMatch, right: WolfXMatch): boolean {
  if (left.offset !== right.offset || left.length !== right.length) return false;
  for (let i = 0; i < Math.min(STREAM_BYTES, left.length); i++) {
    const at = (left.offset + i - 10) % STREAM_BYTES;
    if (left.stream[at] !== right.stream[at]) return false;
  }
  return true;
}

/** 五点采样仅用于筛选候选，无法检出非采样位置的正文损坏。 */
export async function match_wolfx(
  handle: BinaryFileHandle,
  candidates: WolfXCandidates,
  signal?: AbortSignal,
): Promise<Readonly<{ match: WolfXMatch | null; missing: readonly string[] }>> {
  const size = (await handle.stat()).size;
  assert(size >= HEADER_BYTES, "Truncated WOLFX header");
  const header = await read_bytes(handle, 0, HEADER_BYTES);
  assert(header.subarray(0, 5).toString("ascii") === "WOLFX", "Unsupported WOLFX header");
  let match: WolfXMatch | null = null;
  const missing = new Set<string>();
  for (const master of candidates.masters) {
    await setImmediate();
    signal?.throwIfAborted();
    const blob = static_blob(encode_wolfx_key(master)),
      offset = 512 + blob[0]! + blob[1]!;
    if (offset >= size) continue;
    let state = (fnv(blob) ^ header.readUInt32BE(5)) >>> 0;
    for (const byte of blob) state ^= byte;
    const base = new Uint8Array(STREAM_BYTES);
    for (let i = 0; i < base.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      base[i] = state;
    }
    const fields = Buffer.from(header.subarray(10, 15));
    for (let i = 0; i < fields.length; i++) fields[i]! ^= base[i]!;
    const string_id = fields.readUInt16BE();
    const strings = string_id < NO_STRING ? candidates.strings.get(string_id) : [""];
    if (!strings) {
      missing.add("string=" + string_id);
      continue;
    }
    const length = size - offset,
      samples = new Uint8Array(5);
    for (let i = 0; i < samples.length; i++)
      samples[i] = (await read_bytes(handle, offset + Math.floor(((length - 1) * i) / 4), 1))[0]!;
    for (const text of strings) {
      await setImmediate();
      signal?.throwIfAborted();
      const string = encode_wolfx_key(text),
        hash = fnv(string);
      const integer_id = (((hash >>> 16) << 8) ^ (hash & 65535) ^ fields.readUIntBE(2, 3)) >>> 0;
      const integers = integer_id < NO_INTEGER ? candidates.integers.get(integer_id) : [0];
      if (!integers) {
        missing.add("integer=" + integer_id);
        continue;
      }
      for (const value of integers) {
        await setImmediate();
        signal?.throwIfAborted();
        const number = Buffer.alloc(4),
          index = Buffer.alloc(3),
          stream = Uint8Array.from(base);
        number.writeUInt32BE(
          integer_id < NO_INTEGER ? ((value << 13) ^ Math.imul(73244475, value)) >>> 0 : 0,
        );
        index.writeUIntBE(integer_id, 0, 3);
        for (let i = 0; i < stream.length; i++)
          stream[i]! ^=
            fields[i % 2]! ^
            (string.length ? string[i % string.length]! : 0) ^
            number[i % 4]! ^
            index[i % 3]!;
        if (
          !samples.every(
            (byte, i) =>
              (byte ^
                stream[(offset + Math.floor(((length - 1) * i) / 4) - 10) % STREAM_BYTES]!) ===
              (header[15 + i]! ^ stream[5 + i]!),
          )
        )
          continue;
        const candidate = { offset, length, stream };
        assert(!match || same_output(match, candidate), "Ambiguous WOLFX plaintext");
        match = candidate;
      }
    }
  }
  return { match, missing: [...missing] };
}

/** 按匹配结果分块解出正文，密钥流位置相对整个文件。 */
export async function write_wolfx_plaintext(
  input: BinaryFileHandle,
  output: BinaryFileHandle,
  match: WolfXMatch,
  signal?: AbortSignal,
): Promise<void> {
  for (let at = 0; at < match.length; at += BINARY_CHUNK_BYTES) {
    await setImmediate();
    signal?.throwIfAborted();
    const bytes = await read_bytes(
      input,
      match.offset + at,
      Math.min(BINARY_CHUNK_BYTES, match.length - at),
    );
    for (let i = 0; i < bytes.length; i++)
      bytes[i]! ^= match.stream[(match.offset + at + i - 10) % STREAM_BYTES]!;
    await write_bytes(output, bytes, at);
  }
}
